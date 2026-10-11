package services

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/discohaus/discopanel/pkg/minecraft"
	v1 "github.com/discohaus/discopanel/pkg/proto/discopanel/v1"
	"google.golang.org/protobuf/proto"
)

func TestCopyGlobalSnapshot(t *testing.T) {
	motd := "custom"
	rcon := "old-secret"
	port := int32(25580)
	globalPort := int32(25566)
	globalPlayers := int32(42)
	globalMemory := "2048M"
	global := &v1.ServerProperties{
		Id: "global", ServerId: "global",
		ServerPort: &globalPort, MaxPlayers: &globalPlayers, MaxMemory: &globalMemory,
	}
	target := func() *v1.ServerProperties {
		return &v1.ServerProperties{
			Id: "server-config", ServerId: "server", Motd: &motd,
			RconPassword: &rcon, ServerPort: &port,
		}
	}

	full := target()
	beforeFull := proto.Clone(full).(*v1.ServerProperties)
	copyGlobalSnapshot(global, full, false)
	if full.Motd != nil || full.RconPassword != nil {
		t.Fatal("full sync did not clear unset properties")
	}
	if full.GetServerPort() != globalPort || full.GetMaxPlayers() != globalPlayers || full.GetMaxMemory() != globalMemory {
		t.Fatal("full sync did not copy the set properties")
	}
	if full.Id != "server-config" || full.ServerId != "server" {
		t.Fatal("full sync changed row identity")
	}
	fullChanges := buildSyncChanges(beforeFull, full)
	if !hasSyncChange(fullChanges, "motd", true, false) || !hasSyncChange(fullChanges, "serverPort", true, true) {
		t.Fatalf("full preview did not include the cleared MOTD and changed internal port: %+v", fullChanges)
	}

	explicit := target()
	beforeExplicit := proto.Clone(explicit).(*v1.ServerProperties)
	copyGlobalSnapshot(global, explicit, true)
	if explicit.GetMotd() != motd || explicit.GetRconPassword() != rcon {
		t.Fatal("explicit sync cleared unset properties")
	}
	if explicit.GetServerPort() != globalPort {
		t.Fatal("explicit sync did not copy the internal port")
	}
	for _, change := range buildSyncChanges(beforeExplicit, explicit) {
		if change.Key == "motd" || change.Key == "rconPassword" {
			t.Fatal("explicit preview included an unset global value")
		}
	}

	empty := ""
	global.Motd = &empty
	copyGlobalSnapshot(global, explicit, true)
	if explicit.Motd == nil || *explicit.Motd != "" {
		t.Fatal("explicitly set empty string was not copied")
	}
}

func hasSyncChange(changes []*v1.SyncPropertyChange, key string, currentSet, nextSet bool) bool {
	for _, change := range changes {
		if change.Key == key && change.CurrentSet == currentSet && change.NextSet == nextSet {
			return true
		}
	}
	return false
}

func TestValidateSyncedHeapKeepsContainerLimit(t *testing.T) {
	server := &v1.Server{Memory: 2048}
	tooLarge := "1900M"
	if err := validateSyncedHeap(server, &v1.ServerProperties{MaxMemory: &tooLarge}); err == nil {
		t.Fatal("heap larger than unchanged container limit was accepted")
	}
	valid := "1792M"
	if err := validateSyncedHeap(server, &v1.ServerProperties{MaxMemory: &valid}); err != nil {
		t.Fatalf("valid heap was rejected: %v", err)
	}
	if server.Memory != 2048 {
		t.Fatal("container memory changed")
	}
}

func TestFullSyncResetsStaleFileDefaults(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "server.properties")
	if err := os.WriteFile(path, []byte("# keep comment\ndifficulty=hard\nmotd=old message\nserver-name=old name\ncustom-key=keep\n"), 0600); err != nil {
		t.Fatal(err)
	}
	current, err := minecraft.LoadPropertiesFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	global := &v1.ServerProperties{}
	if plan := planSyncFileChanges(global, nil, false); len(plan.Changes) != 0 {
		t.Fatal("missing file on a fresh server produced artificial changes")
	}
	if plan := planSyncFileChanges(global, current, true); len(plan.Changes) != 0 {
		t.Fatal("explicit-only sync changed file values for unset globals")
	}
	plan := planSyncFileChanges(global, current, false)
	if plan.Values["difficulty"] != "easy" {
		t.Fatalf("difficulty reset = %q, want easy", plan.Values["difficulty"])
	}
	preview := mergeSyncPreviewChanges(nil, plan.Changes)
	if !hasSyncChange(preview, "difficulty", true, true) {
		t.Fatal("preview omitted the file-only default reset")
	}
	if err := minecraft.SavePropertiesFile(dir, plan.Values, plan.Remove...); err != nil {
		t.Fatal(err)
	}
	after, err := minecraft.LoadPropertiesFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	if after["difficulty"] != "easy" || after["motd"] != "A DiscoPanel Server" || after["custom-key"] != "keep" {
		t.Fatalf("reset did not preserve the correct values: %v", after)
	}
	if _, ok := after["server-name"]; ok {
		t.Fatal("old value without an annotation default remained in server.properties")
	}
	categories, err := buildPropertyCategories(&v1.ServerProperties{}, after)
	if err != nil {
		t.Fatal(err)
	}
	for _, category := range categories {
		for _, property := range category.Properties {
			if property.Key == "difficulty" && property.GetDefaultValue() != "easy" {
				t.Fatalf("UI default = %q, want easy", property.GetDefaultValue())
			}
		}
	}
}
