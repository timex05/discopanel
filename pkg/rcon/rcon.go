// Basic Rcon implementation according to https://minecraft.wiki/Rcon
package rcon

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/discohaus/discopanel/pkg/logger"
	"golang.org/x/text/encoding/charmap"
)

const (
	packetAuth          int32 = 3
	packetAuthResponse  int32 = 2
	packetExecCommand   int32 = 2
	packetResponseValue int32 = 0

	defaultTimeout = 5 * time.Second
)

type RconPacket struct {
	Size int32
	ID   int32
	Type int32
	Body string
}

type Client struct {
	host     string
	port     int
	password string
	log      *logger.Logger

	packetID atomic.Int32
	mu       sync.Mutex
}

func NewClient(host string, port int, password string, log *logger.Logger) *Client {
	return &Client{
		host:     host,
		port:     port,
		password: password,
		log:      log,
	}
}

func (c *Client) Host() string     { return c.host }
func (c *Client) Port() int        { return c.port }
func (c *Client) Password() string { return c.password }

func (c *Client) nextPacketID() int32 {
	id := c.packetID.Add(1)

	if id <= 0 {
		c.packetID.Store(1)
		return 1
	}

	return id
}

func (c *Client) Execute(command string) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	addr := net.JoinHostPort(c.host, fmt.Sprintf("%d", c.port))
	c.logDebug("Verbinde mit %s...", addr)

	conn, err := net.DialTimeout("tcp", addr, defaultTimeout)
	if err != nil {
		return "", fmt.Errorf("failed to connect to RCON server: %w", err)
	}
	defer func() {
		c.logDebug("Schließe TCP Verbindung")
		conn.Close()
	}()

	_ = conn.SetDeadline(time.Now().Add(defaultTimeout))
	reader := bufio.NewReader(conn)

	// 1. Authentication
	if err := c.authenticate(conn, reader); err != nil {
		return "", fmt.Errorf("rcon authentication failed: %w", err)
	}

	// 2. Send the command packet
	cmdID := c.nextPacketID()
	cmdPacket := RconPacket{
		ID:   cmdID,
		Type: packetExecCommand,
		Body: command,
	}

	c.logDebug("Sende Command Packet (ID: %d, Cmd: %q)", cmdID, command)
	if err := writePacket(conn, cmdPacket, c.log); err != nil {
		return "", fmt.Errorf("failed to send command: %w", err)
	}

	// 3. Read packets
	var response strings.Builder
	firstPacketReceived := false

	for {
		resp, err := readPacket(reader, c.log)
		if err != nil {
			// if server closes the connection
			if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
				c.logDebug("Server hat Verbindung getrennt (EOF empfangen)")
				if response.Len() > 0 {
					return response.String(), nil
				}
			}
			return "", err
		}

		c.logDebug("Empfange Packet (ID: %d, Type: %d, Size: %d, BodyLen: %d)", resp.ID, resp.Type, resp.Size, len(resp.Body))

		if resp.ID == cmdID {
			response.WriteString(resp.Body)

			// after receiving the first packet, we send a terminator packet to signal the end of the command response
			if !firstPacketReceived {
				firstPacketReceived = true

				termID := c.nextPacketID()
				terminator := RconPacket{
					ID:   termID,
					Type: packetExecCommand,
					Body: "",
				}

				c.logDebug("Sende Terminator Packet (ID: %d)", termID)
				if err := writePacket(conn, terminator, c.log); err != nil {
					// fallback if terminator packet fails, we return the response we have so far
					return response.String(), nil
				}
			}
		} else {
			// id does not match, we ignore this packet and break
			c.logDebug("Terminator Response empfangen (ID: %d). Lesen beendet.", resp.ID)
			break
		}
	}

	return response.String(), nil
}

func (c *Client) authenticate(conn net.Conn, reader *bufio.Reader) error {
	authID := c.nextPacketID()
	authPacket := RconPacket{
		ID:   authID,
		Type: packetAuth,
		Body: c.password,
	}

	c.logDebug("Sende Auth Packet (ID: %d)", authID)
	if err := writePacket(conn, authPacket, c.log); err != nil {
		return fmt.Errorf("failed to send auth packet: %w", err)
	}

	// Minecraft schickt bei Auth manchmal erst ein leeres ResponseValue (Type 0) und dann AuthResponse (Type 2).
	for {
		response, err := readPacket(reader, c.log)
		if err != nil {
			return fmt.Errorf("failed to read auth response: %w", err)
		}

		c.logDebug("Empfange Auth-Response Packet (ID: %d, Type: %d)", response.ID, response.Type)

		if response.ID == -1 {
			return fmt.Errorf("invalid password")
		}

		if response.ID == authID {
			c.logDebug("Authentifizierung erfolgreich")
			break
		}
	}

	return nil
}

func (c *Client) logDebug(format string, v ...any) {
	if c.log != nil {
		c.log.Debug(fmt.Sprintf("[RCON] "+format, v...))
	} else {
		fmt.Printf("[RCON DEBUG] "+format+"\n", v...)
	}
}

func writePacket(conn net.Conn, packet RconPacket, log *logger.Logger) error {
	bodyBytes := []byte(packet.Body)
	size := 4 + 4 + len(bodyBytes) + 2

	buf := make([]byte, 4+size)

	binary.LittleEndian.PutUint32(buf[0:4], uint32(size))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(packet.ID))
	binary.LittleEndian.PutUint32(buf[8:12], uint32(packet.Type))

	copy(buf[12:], bodyBytes)

	buf[len(buf)-2] = 0x00
	buf[len(buf)-1] = 0x00

	_, err := conn.Write(buf)
	return err
}

func readPacket(reader *bufio.Reader, log *logger.Logger) (RconPacket, error) {
	var packet RconPacket

	sizeBytes := make([]byte, 4)
	if _, err := io.ReadFull(reader, sizeBytes); err != nil {
		return packet, fmt.Errorf("failed to read packet size: %w", err)
	}

	size := binary.LittleEndian.Uint32(sizeBytes)

	if size < 8 || size > 1457000 {
		return packet, fmt.Errorf("invalid packet size: %d", size)
	}

	packetBytes := make([]byte, size)
	if _, err := io.ReadFull(reader, packetBytes); err != nil {
		return packet, fmt.Errorf("failed to read packet payload: %w", err)
	}

	packet.Size = int32(size)
	packet.ID = int32(binary.LittleEndian.Uint32(packetBytes[0:4]))
	packet.Type = int32(binary.LittleEndian.Uint32(packetBytes[4:8]))
	packet.Body = decodeOutput(packetBytes[8 : len(packetBytes)-2])

	return packet, nil
}

func decodeOutput(input []byte) string {
	if utf8.Valid(input) {
		return string(input)
	}

	decoded, err := charmap.ISO8859_1.NewDecoder().Bytes(input)
	if err == nil {
		return string(decoded)
	}

	return string(bytes.ToValidUTF8(input, []byte("?")))
}
