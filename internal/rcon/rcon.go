package rcon

import (
	"context"
	"strconv"

	"github.com/jltobler/go-rcon"
)

func SendCommand(ctx context.Context, RCONHost string, RCONPort int, RCONPassword string, command string) (string, error) {
	rconClient := rcon.NewClient("rcon://"+RCONHost+":"+strconv.Itoa(RCONPort), RCONPassword)
	type rconResult struct {
		output string
		err    error
	}

	resultCh := make(chan rconResult, 1)
	go func() {
		output, sendErr := rconClient.Send(command)
		resultCh <- rconResult{output: output, err: sendErr}
	}()

	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case result := <-resultCh:
		if result.err == nil {
			return result.output, nil
		}

		return "", result.err
	}
}
