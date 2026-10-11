package db

import (
	"context"
	"testing"

	"github.com/discohaus/discopanel/pkg/config"
	v1 "github.com/discohaus/discopanel/pkg/proto/discopanel/v1"
)

func TestInContainerPortUsesProperties(t *testing.T) {
	server := &v1.Server{Port: 25580}
	inner := int32(25566)
	config := &v1.ServerProperties{ServerPort: &inner}
	if got := InContainerPort(config); got != 25566 {
		t.Fatalf("internal port = %d, want 25566", got)
	}
	if server.Port != 25580 {
		t.Fatalf("external port changed to %d", server.Port)
	}
	if got := InContainerPort(&v1.ServerProperties{}); got != MinecraftDefaultPort {
		t.Fatalf("unset direct port = %d, want default internal port", got)
	}
}

func TestNewServerInheritsExplicitGlobalProperties(t *testing.T) {
	store, err := NewSQLiteStore(&config.Config{Database: config.DatabaseConfig{Path: ":memory:"}})
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	ctx := context.Background()
	global, _, err := store.GetGlobalSettings(ctx)
	if err != nil {
		t.Fatal(err)
	}
	password := "global-secret"
	innerPort := int32(25565)
	players := int32(42)
	maxHeap := "1400M"
	global.RconPassword = &password
	global.ServerPort = &innerPort
	global.MaxPlayers = &players
	global.MaxMemory = &maxHeap
	if err := store.UpdateGlobalSettings(ctx, global); err != nil {
		t.Fatal(err)
	}
	server := &v1.Server{Id: "fresh", Name: "Fresh", Port: 25568, MaxPlayers: 20, Memory: 2048, MemoryMin: 1024, MemoryMax: 1536}
	if err := store.CreateServer(ctx, server); err != nil {
		t.Fatal(err)
	}
	properties, err := store.GetServerProperties(ctx, server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if properties.GetRconPassword() != password || properties.GetServerPort() != innerPort ||
		properties.GetMaxPlayers() != players || properties.GetMaxMemory() != maxHeap {
		t.Fatalf("explicit global settings were not inherited: %+v", properties)
	}
	server.Port = 25569
	if err := store.UpdateServer(ctx, server); err != nil {
		t.Fatal(err)
	}
	properties, err = store.GetServerProperties(ctx, server.Id)
	if err != nil {
		t.Fatal(err)
	}
	if properties.GetServerPort() != innerPort {
		t.Fatalf("changing the outer port changed the inner port to %d", properties.GetServerPort())
	}

	global.ServerPort = nil
	if err := store.UpdateGlobalSettings(ctx, global); err != nil {
		t.Fatal(err)
	}
	unconfigured := &v1.Server{Id: "fresh-unconfigured", Name: "Fresh without inner port", Port: 25570, MaxPlayers: 20, Memory: 2048, MemoryMin: 1024, MemoryMax: 1536}
	if err := store.CreateServer(ctx, unconfigured); err != nil {
		t.Fatal(err)
	}
	properties, err = store.GetServerProperties(ctx, unconfigured.Id)
	if err != nil {
		t.Fatal(err)
	}
	if properties.ServerPort != nil || InContainerPort(properties) != MinecraftDefaultPort {
		t.Fatalf("unset global inner port inherited outer port: %+v", properties.ServerPort)
	}
}
