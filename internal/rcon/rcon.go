package rcon

import (
	"bufio"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"time"

	"github.com/nickheyer/discopanel/pkg/logger"
)

const (
	packetAuth          int32 = 3
	packetAuthResponse  int32 = 2
	packetExecCommand   int32 = 2
	packetResponseValue int32 = 0

	defaultTimeout = 3 * time.Second
)

type RconPacket struct {
	Size int32
	ID   int32
	Type int32
	Body string
}

func SendCommand(host string, port int, password string, command string, log *logger.Logger) (string, error) {

	addr := net.JoinHostPort(host, fmt.Sprintf("%d", port))

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		return "", fmt.Errorf("failed to connect to RCON server: %w", err)
	}
	defer conn.Close()

	err = conn.SetDeadline(time.Now().Add(defaultTimeout))
	if err != nil {
		return "", fmt.Errorf("failed to set timeout: %w", err)
	}
	defer conn.Close()

	reader := bufio.NewReader(conn)

	authErr := authenticate(conn, reader, password, log)
	if authErr != nil {
		return "", authErr
	}

	cmdPacket := RconPacket{
		ID:   2,
		Type: packetExecCommand,
		Body: command,
	}

	err = writePacket(conn, cmdPacket, log)
	if err != nil {
		return "", err
	}

	var response strings.Builder
	for {
		respPacket, err := readPacket(reader, log)
		if err != nil {
			return "", fmt.Errorf("failed to read response packet: %w", err)
		}
		if respPacket.ID == cmdPacket.ID && respPacket.Type == packetResponseValue {
			response.WriteString(respPacket.Body)
		}
		if len(respPacket.Body) < 4096-10 {
			break
		}

	}

	return response.String(), nil
}

func authenticate(conn net.Conn, reader *bufio.Reader, password string, log *logger.Logger) error {
	authPacket := RconPacket{
		ID:   1,
		Type: packetAuth,
		Body: password,
	}
	err := writePacket(conn, authPacket, log)
	if err != nil {
		return fmt.Errorf("failed to send auth packet: %w", err)
	}

	response, err := readPacket(reader, log)
	if err != nil {
		return fmt.Errorf("failed to read auth response: %w", err)
	}

	if response.ID == -1 || response.Type != packetAuthResponse {
		return fmt.Errorf("authentication failed: invalid response")
	}
	return nil
}

func writePacket(conn net.Conn, packet RconPacket, log *logger.Logger) error {
	log.Debug("Sending Packet: ID=%d, Type=%d, Body=%q\n", packet.ID, packet.Type, packet.Body)

	size := 4 + 4 + len(packet.Body) + 2

	buf := make([]byte, 4+size)

	binary.LittleEndian.PutUint32(buf[0:4], uint32(size))
	binary.LittleEndian.PutUint32(buf[4:8], uint32(packet.ID))
	binary.LittleEndian.PutUint32(buf[8:12], uint32(packet.Type))

	copy(buf[12:], []byte(packet.Body))

	buf[len(buf)-2] = 0x00
	buf[len(buf)-1] = 0x00

	_, err := conn.Write(buf)

	return err
}

func readPacket(reader *bufio.Reader, log *logger.Logger) (RconPacket, error) {
	var packet RconPacket

	sizeBytes := make([]byte, 4)
	_, err := io.ReadFull(reader, sizeBytes)
	if err != nil {
		return packet, fmt.Errorf("failed to read packet size: %w", err)
	}

	size := binary.LittleEndian.Uint32(sizeBytes)
	packetBytes := make([]byte, size)
	_, err = io.ReadFull(reader, packetBytes)
	if err != nil {
		return packet, fmt.Errorf("failed to read packet data: %w", err)
	}

	packet.Size = int32(size)
	packet.ID = int32(binary.LittleEndian.Uint32(packetBytes[0:4]))
	packet.Type = int32(binary.LittleEndian.Uint32(packetBytes[4:8]))
	packet.Body = decodeMinecraftCodes(packetBytes[8 : len(packetBytes)-2])

	log.Debug("Received Packet: ID=%d, Type=%d, Body=%q\n", packet.ID, packet.Type, packet.Body)

	return packet, nil
}

func decodeMinecraftCodes(input []byte) string {
	var buf strings.Builder

	for i := range len(input) {
		b := input[i]
		if b == 0xa7 && i+1 < len(input) {
			// Minecraft § color code — write the UTF-8 § sign
			buf.WriteString("§")
		} else if b < 0x80 {
			// Safe ASCII
			buf.WriteByte(b)
		}
	}
	return buf.String()
}
