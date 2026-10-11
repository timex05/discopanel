package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/discohaus/discopanel/internal/auth"
	storage "github.com/discohaus/discopanel/internal/db"
	"github.com/discohaus/discopanel/internal/docker"
	"github.com/discohaus/discopanel/internal/lifecycle"
	"github.com/discohaus/discopanel/internal/metrics"
	"github.com/discohaus/discopanel/pkg/config"
	"github.com/discohaus/discopanel/pkg/logger"
	"github.com/discohaus/discopanel/pkg/minecraft"
	optionsv1 "github.com/discohaus/discopanel/pkg/proto/discopanel/options/v1"
	v1 "github.com/discohaus/discopanel/pkg/proto/discopanel/v1"
	"github.com/discohaus/discopanel/pkg/proto/discopanel/v1/discopanelv1connect"
	"github.com/discohaus/discopanel/pkg/protometa"
	"github.com/discohaus/discopanel/pkg/runtimespec"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"
)

var _ discopanelv1connect.PropertiesServiceHandler = (*PropertiesService)(nil)

type PropertiesService struct {
	store     *storage.Store
	config    *config.Config
	docker    *docker.Client
	lifecycle *lifecycle.Manager
	auth      *auth.Manager
	rec       *metrics.Recorder
	log       *logger.Logger
}

// Creates new config service
func NewPropertiesService(store *storage.Store, cfg *config.Config, docker *docker.Client, lifecycleManager *lifecycle.Manager, authManager *auth.Manager, rec *metrics.Recorder, log *logger.Logger) *PropertiesService {
	return &PropertiesService{
		store:     store,
		config:    cfg,
		docker:    docker,
		lifecycle: lifecycleManager,
		auth:      authManager,
		rec:       rec,
		log:       log,
	}
}

// Gets server config
func (s *PropertiesService) GetServerProperties(ctx context.Context, req *connect.Request[v1.GetServerPropertiesRequest]) (*connect.Response[v1.GetServerPropertiesResponse], error) {
	msg := req.Msg

	// Get server to ensure it exists
	server, err := getServer(ctx, s.store, msg.ServerId)
	if err != nil {
		return nil, err
	}

	// Read the saved properties without overwriting them from the Server row.
	config, err := s.store.GetServerProperties(ctx, msg.ServerId)
	if err != nil {
		s.log.Error("Failed to get server config: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get server properties"))
	}

	// Convert to categorized format
	categories, err := buildPropertyCategories(config, serverFileProps(server))
	if err != nil {
		s.log.Error("Failed to build config categories: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to format properties"))
	}

	return connect.NewResponse(&v1.GetServerPropertiesResponse{
		Categories: categories,
	}), nil
}

// Updates server config
func (s *PropertiesService) UpdateServerProperties(ctx context.Context, req *connect.Request[v1.UpdateServerPropertiesRequest]) (*connect.Response[v1.UpdateServerPropertiesResponse], error) {
	msg := req.Msg

	// Get server info
	server, err := getServer(ctx, s.store, msg.ServerId)
	if err != nil {
		return nil, err
	}

	// Get existing config
	config, err := s.store.GetServerProperties(ctx, msg.ServerId)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			config = s.store.CreateDefaultServerProperties(msg.ServerId)
		} else {
			s.log.Error("Failed to get server config: %v", err)
			return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get server properties"))
		}
	}

	// Apply updates w/ reflection
	before := proto.Clone(config)
	if err := applyPropertyUpdates(config, msg.Updates); err != nil {
		s.log.Error("Failed to apply config updates: %v", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	changed := !proto.Equal(before, config)

	// Save updated config
	if err := s.store.UpdateServerProperties(ctx, config); err != nil {
		s.log.Error("Failed to save server config: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to save server properties"))
	}
	s.rec.Record(ctx, server.Id, v1.ServerActionKind_SERVER_ACTION_KIND_PROPERTIES_UPDATE, metrics.Attrs{"changed": strconv.Itoa(len(msg.Updates))}, "updated server properties (%d changed)", len(msg.Updates))

	// Unchanged values must not bounce a running server
	if changed && server.ContainerId != "" && s.lifecycle != nil {
		s.applyPropertiesToRunningServer(ctx, server)
	}

	// Reconciles proxy route right away without server start
	if s.lifecycle != nil {
		s.lifecycle.SyncProxyRoute(ctx, msg.ServerId)
	}

	// Return updated config
	categories, err := buildPropertyCategories(config, serverFileProps(server))
	if err != nil {
		s.log.Error("Failed to build config categories: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to format properties"))
	}

	return connect.NewResponse(&v1.UpdateServerPropertiesResponse{
		Categories: categories,
	}), nil
}

// Gets global settings
func (s *PropertiesService) GetGlobalSettings(ctx context.Context, req *connect.Request[v1.GetGlobalSettingsRequest]) (*connect.Response[v1.GetGlobalSettingsResponse], error) {
	config, _, err := s.store.GetGlobalSettings(ctx)
	if err != nil {
		s.log.Error("Failed to get global settings: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get global settings"))
	}

	categories, err := buildPropertyCategories(config, nil)
	if err != nil {
		s.log.Error("Failed to build config categories: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to format properties"))
	}

	return connect.NewResponse(&v1.GetGlobalSettingsResponse{
		Categories: categories,
	}), nil
}

// Updates global settings
func (s *PropertiesService) UpdateGlobalSettings(ctx context.Context, req *connect.Request[v1.UpdateGlobalSettingsRequest]) (*connect.Response[v1.UpdateGlobalSettingsResponse], error) {
	msg := req.Msg
	config, _, err := s.store.GetGlobalSettings(ctx)
	if err != nil {
		s.log.Error("Failed to get global settings: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get global settings"))
	}

	if err := applyPropertyUpdates(config, msg.Updates); err != nil {
		s.log.Error("Failed to apply config updates: %v", err)
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}

	if err := s.store.UpdateGlobalSettings(ctx, config); err != nil {
		s.log.Error("Failed to save global settings: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to save global settings"))
	}

	categories, err := buildPropertyCategories(config, nil)
	if err != nil {
		s.log.Error("Failed to build config categories: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to format properties"))
	}

	return connect.NewResponse(&v1.UpdateGlobalSettingsResponse{
		Categories: categories,
	}), nil
}

// Pushes the saved global defaults onto existing servers
func (s *PropertiesService) SyncGlobalSettingsToServers(ctx context.Context, req *connect.Request[v1.SyncGlobalSettingsToServersRequest]) (*connect.Response[v1.SyncGlobalSettingsToServersResponse], error) {
	msg := req.Msg

	// Dedupe while keeping request order
	seen := make(map[string]bool, len(msg.ServerIds))
	serverIDs := make([]string, 0, len(msg.ServerIds))
	for _, id := range msg.ServerIds {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		serverIDs = append(serverIDs, id)
	}
	if len(serverIDs) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("no servers selected"))
	}

	global, _, err := s.store.GetGlobalSettings(ctx)
	if err != nil {
		s.log.Error("Failed to get global settings for sync: %v", err)
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get global settings"))
	}

	if s.lifecycle == nil || s.docker == nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("server lifecycle is unavailable"))
	}

	results := make([]*v1.SyncServerResult, 0, len(serverIDs))
	for _, id := range serverIDs {
		if ctx.Err() != nil {
			results = append(results, &v1.SyncServerResult{
				ServerId: id,
				Success:  false,
				Error:    "sync cancelled",
			})
			continue
		}
		results = append(results, s.syncGlobalToServer(ctx, global, id, msg.OnlyExplicit))
	}

	return connect.NewResponse(&v1.SyncGlobalSettingsToServersResponse{
		Results: results,
	}), nil
}

// Returns the exact stored-property changes for both checkbox states.
func (s *PropertiesService) PreviewGlobalSettingsSync(ctx context.Context, req *connect.Request[v1.PreviewGlobalSettingsSyncRequest]) (*connect.Response[v1.PreviewGlobalSettingsSyncResponse], error) {
	global, _, err := s.store.GetGlobalSettings(ctx)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, errors.New("failed to get global settings"))
	}

	seen := make(map[string]bool, len(req.Msg.ServerIds))
	previews := make([]*v1.SyncServerPreview, 0, len(req.Msg.ServerIds))
	for _, id := range req.Msg.ServerIds {
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		preview := &v1.SyncServerPreview{ServerId: id}
		if s.auth == nil || !s.auth.CanFor(ctx, optionsv1.ResourceType_RESOURCE_TYPE_SERVER_PROPERTIES, optionsv1.ActionType_ACTION_TYPE_READ, id) ||
			!s.auth.CanFor(ctx, optionsv1.ResourceType_RESOURCE_TYPE_SERVER_PROPERTIES, optionsv1.ActionType_ACTION_TYPE_UPDATE, id) ||
			!s.auth.CanFor(ctx, optionsv1.ResourceType_RESOURCE_TYPE_SERVERS, optionsv1.ActionType_ACTION_TYPE_RESTART, id) {
			preview.Error = "insufficient server permissions"
			previews = append(previews, preview)
			continue
		}
		server, err := getServer(ctx, s.store, id)
		if err != nil {
			preview.Error = err.Error()
			previews = append(previews, preview)
			continue
		}
		preview.ServerName = server.Name
		current, err := s.store.GetServerProperties(ctx, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			current = s.store.CreateDefaultServerProperties(id)
		} else if err != nil {
			preview.Error = "failed to get server properties"
			previews = append(previews, preview)
			continue
		}

		all := proto.Clone(current).(*v1.ServerProperties)
		copyGlobalSnapshot(global, all, false)
		fileProps := serverFileProps(server)
		allFilePlan := planSyncFileChanges(global, fileProps, false)
		preview.AllChanges = mergeSyncPreviewChanges(buildSyncChanges(current, all), allFilePlan.Changes)
		if !proto.Equal(current, all) || len(allFilePlan.Changes) > 0 {
			if err := validateSyncSnapshot(server, all); err != nil {
				preview.AllError = err.Error()
			}
		}

		explicit := proto.Clone(current).(*v1.ServerProperties)
		copyGlobalSnapshot(global, explicit, true)
		explicitFilePlan := planSyncFileChanges(global, fileProps, true)
		preview.ExplicitChanges = mergeSyncPreviewChanges(buildSyncChanges(current, explicit), explicitFilePlan.Changes)
		if !proto.Equal(current, explicit) || len(explicitFilePlan.Changes) > 0 {
			if err := validateSyncSnapshot(server, explicit); err != nil {
				preview.ExplicitError = err.Error()
			}
		}
		previews = append(previews, preview)
	}
	if len(previews) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errors.New("no servers selected"))
	}
	return connect.NewResponse(&v1.PreviewGlobalSettingsSyncResponse{Previews: previews}), nil
}

// Copies the global snapshot onto one server: stop if up, overwrite,
// drop the stale container, then restore the prior running state
func (s *PropertiesService) syncGlobalToServer(ctx context.Context, global *v1.ServerProperties, serverID string, onlyExplicit bool) *v1.SyncServerResult {
	res := &v1.SyncServerResult{ServerId: serverID}
	fail := func(err error) *v1.SyncServerResult {
		res.Success = false
		res.Error = err.Error()
		return res
	}
	if s.auth == nil || !s.auth.CanFor(ctx, optionsv1.ResourceType_RESOURCE_TYPE_SERVER_PROPERTIES, optionsv1.ActionType_ACTION_TYPE_UPDATE, serverID) ||
		!s.auth.CanFor(ctx, optionsv1.ResourceType_RESOURCE_TYPE_SERVERS, optionsv1.ActionType_ACTION_TYPE_RESTART, serverID) {
		return fail(errors.New("insufficient server permissions"))
	}

	server, err := getServer(ctx, s.store, serverID)
	if err != nil {
		return fail(err)
	}
	res.ServerName = server.Name

	liveStatus := server.Status
	if server.ContainerId != "" {
		if st, err := s.docker.GetContainerStatus(ctx, server.ContainerId); err == nil {
			liveStatus = st
		}
	}
	res.PriorStatus = shortStatusName(liveStatus)

	// Transitional states must not be interrupted mid-flight
	switch liveStatus {
	case v1.ServerStatus_SERVER_STATUS_CREATING,
		v1.ServerStatus_SERVER_STATUS_PROVISIONING,
		v1.ServerStatus_SERVER_STATUS_STARTING,
		v1.ServerStatus_SERVER_STATUS_STOPPING:
		return fail(fmt.Errorf("server is busy (%s), try again later", res.PriorStatus))
	}

	wasUp := liveStatus == v1.ServerStatus_SERVER_STATUS_RUNNING ||
		liveStatus == v1.ServerStatus_SERVER_STATUS_UNHEALTHY ||
		liveStatus == v1.ServerStatus_SERVER_STATUS_PAUSED

	target, err := s.store.GetServerProperties(ctx, server.Id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			target = s.store.CreateDefaultServerProperties(server.Id)
		} else {
			s.log.Error("Failed to get server config for sync %s: %v", server.Name, err)
			return fail(errors.New("failed to get server properties"))
		}
	}

	before := proto.Clone(target)
	copyGlobalSnapshot(global, target, onlyExplicit)
	filePlan := planSyncFileChanges(global, serverFileProps(server), onlyExplicit)
	if proto.Equal(before, target) && len(filePlan.Changes) == 0 {
		res.Success = true
		res.FinalStatus = res.PriorStatus
		return res
	}

	if err := validateSyncSnapshot(server, target); err != nil {
		return fail(err)
	}

	if wasUp {
		stopCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
		err := s.lifecycle.Stop(stopCtx, server.Id)
		cancel()
		if err != nil {
			return fail(fmt.Errorf("failed to stop server: %w", err))
		}
		if server, err = getServer(ctx, s.store, server.Id); err != nil {
			return fail(err)
		}
		// The game may write server.properties while shutting down.
		filePlan = planSyncFileChanges(global, serverFileProps(server), onlyExplicit)
	}
	if len(filePlan.Changes) > 0 {
		if err := minecraft.SavePropertiesFile(server.DataPath, filePlan.Values, filePlan.Remove...); err != nil {
			return fail(fmt.Errorf("failed to reset server.properties: %w", err))
		}
	}

	if err := s.store.UpdateServerProperties(ctx, target); err != nil {
		s.log.Error("Failed to save synced config %s: %v", server.Name, err)
		return fail(errors.New("failed to save server properties"))
	}
	s.rec.Record(ctx, server.Id, v1.ServerActionKind_SERVER_ACTION_KIND_PROPERTIES_UPDATE,
		metrics.Attrs{"only_explicit": strconv.FormatBool(onlyExplicit)},
		"synced global settings (only explicitly set: %v)", onlyExplicit)

	// Drop the stale container so the next start recreates it from the new config
	if server.ContainerId != "" {
		if err := s.docker.RemoveContainer(ctx, server.ContainerId); err != nil {
			return fail(fmt.Errorf("settings saved but failed to remove stale container: %w", err))
		}
		server.ContainerId = ""
		if err := s.store.UpdateServerFields(ctx, server.Id, map[string]any{"container_id": ""}); err != nil {
			s.log.Error("Failed to clear container for sync %s: %v", server.Name, err)
			return fail(errors.New("failed to clear stale container"))
		}
		s.rec.Record(ctx, server.Id, v1.ServerActionKind_SERVER_ACTION_KIND_CONTAINER_RECREATE,
			metrics.Attrs{"reason": "settings-sync"}, "recreating the container from synced settings")
	}

	if s.lifecycle != nil {
		s.lifecycle.SyncProxyRoute(ctx, server.Id)
	}

	if wasUp {
		startCtx, cancel := context.WithTimeout(ctx, 2*time.Hour)
		err := s.lifecycle.Start(startCtx, server.Id)
		cancel()
		if err != nil {
			res.FinalStatus = shortStatusName(v1.ServerStatus_SERVER_STATUS_ERROR)
			return fail(fmt.Errorf("settings applied but failed to restart: %w", err))
		}
	}

	if fresh, err := getServer(ctx, s.store, server.Id); err == nil {
		finalStatus := fresh.Status
		if fresh.ContainerId != "" {
			if st, err := s.docker.GetContainerStatus(ctx, fresh.ContainerId); err == nil {
				finalStatus = st
			}
		}
		res.FinalStatus = shortStatusName(finalStatus)
	} else {
		res.FinalStatus = res.PriorStatus
	}
	res.Success = true
	return res
}

// Copies every global field onto the target row. In full mode an unset
// global clears the server value (e.g. a custom MOTD is reset); with
// onlyExplicit set fields alone are copied and custom values survive.
func copyGlobalSnapshot(global, target *v1.ServerProperties, onlyExplicit bool) {
	gm := global.ProtoReflect()
	tm := target.ProtoReflect()
	fields := gm.Descriptor().Fields()

	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		key := fd.JSONName()
		if key == "id" || key == "serverId" || key == "updatedAt" {
			continue
		}
		if onlyExplicit && !gm.Has(fd) {
			continue
		}
		if !gm.Has(fd) {
			tm.Clear(fd)
			continue
		}
		if fd.IsList() {
			src := gm.Get(fd).List()
			tm.Clear(fd)
			dst := tm.Mutable(fd).List()
			for j := 0; j < src.Len(); j++ {
				dst.Append(src.Get(j))
			}
			continue
		}
		if fd.IsMap() {
			src := gm.Get(fd).Map()
			tm.Clear(fd)
			dst := tm.Mutable(fd).Map()
			src.Range(func(k protoreflect.MapKey, v protoreflect.Value) bool {
				dst.Set(k, v)
				return true
			})
			continue
		}
		tm.Set(fd, gm.Get(fd))
	}
}

func buildSyncChanges(current, next *v1.ServerProperties) []*v1.SyncPropertyChange {
	before := current.ProtoReflect()
	after := next.ProtoReflect()
	labels := make(map[protoreflect.Name]string)
	for _, property := range protometa.Props(before.Descriptor()) {
		labels[property.Field.Name()] = property.Meta.Label
	}
	fields := before.Descriptor().Fields()
	changes := make([]*v1.SyncPropertyChange, 0)
	for i := 0; i < fields.Len(); i++ {
		field := fields.Get(i)
		key := field.JSONName()
		if key == "id" || key == "serverId" || key == "updatedAt" {
			continue
		}
		oldValue, oldSet := protometa.ScalarString(before, field)
		newValue, newSet := protometa.ScalarString(after, field)
		if oldSet == newSet && oldValue == newValue {
			continue
		}
		label := labels[field.Name()]
		if label == "" {
			label = key
		}
		changes = append(changes, &v1.SyncPropertyChange{
			Key: key, Label: label,
			CurrentValue: oldValue, CurrentSet: oldSet,
			NextValue: newValue, NextSet: newSet,
		})
	}
	return changes
}

type syncFilePlan struct {
	Values  minecraft.PropertiesFile
	Remove  []string
	Changes []*v1.SyncPropertyChange
}

// Reconciles file-backed defaults as well as the database row. Unset globals
// restore the DiscoPanel annotation default or remove keys without one.
func planSyncFileChanges(global *v1.ServerProperties, existing minecraft.PropertiesFile, onlyExplicit bool) syncFilePlan {
	plan := syncFilePlan{Values: minecraft.PropertiesFile{}}
	if existing == nil {
		// A server that has never started has no file to reconcile yet.
		return plan
	}
	m := global.ProtoReflect()
	for _, property := range protometa.Props(m.Descriptor()) {
		key := property.Meta.Prop
		if key == "" || key == "-" || (onlyExplicit && !m.Has(property.Field)) {
			continue
		}
		next, nextSet := protometa.ScalarString(m, property.Field)
		if !nextSet && property.Meta.DefaultValue != "" {
			next, nextSet = property.Meta.DefaultValue, true
		}
		current, currentSet := existing[key]
		if currentSet == nextSet && current == next {
			continue
		}
		label := property.Meta.Label
		if label == "" {
			label = property.Field.JSONName()
		}
		plan.Changes = append(plan.Changes, &v1.SyncPropertyChange{
			Key: property.Field.JSONName(), Label: label,
			CurrentValue: current, CurrentSet: currentSet,
			NextValue: next, NextSet: nextSet,
		})
		if nextSet {
			plan.Values[key] = next
		} else {
			plan.Remove = append(plan.Remove, key)
		}
	}
	sort.Strings(plan.Remove)
	return plan
}

// Show the effective file value for fields changed in both places, once.
func mergeSyncPreviewChanges(stored, file []*v1.SyncPropertyChange) []*v1.SyncPropertyChange {
	index := make(map[string]int, len(stored))
	for i, change := range stored {
		index[change.Key] = i
	}
	for _, change := range file {
		if i, ok := index[change.Key]; ok {
			stored[i] = change
		} else {
			stored = append(stored, change)
		}
	}
	return stored
}

func validateSyncSnapshot(server *v1.Server, target *v1.ServerProperties) error {
	if target.ServerPort != nil && (*target.ServerPort < 1 || *target.ServerPort > 65535) {
		return fmt.Errorf("invalid internal server port %d", *target.ServerPort)
	}
	return validateSyncedHeap(server, target)
}

// Heap properties may change while the outer container memory limit does not.
func validateSyncedHeap(server *v1.Server, target *v1.ServerProperties) error {
	parse := func(name string, value *string) (int, error) {
		if value == nil || strings.TrimSpace(*value) == "" {
			return 0, nil
		}
		mb := runtimespec.ParseMemoryMB(*value)
		if mb <= 0 {
			return 0, fmt.Errorf("invalid %s %q", name, *value)
		}
		return mb, nil
	}
	initial, err := parse("initial heap", target.InitMemory)
	if err != nil {
		return err
	}
	maximum, err := parse("maximum heap", target.MaxMemory)
	if err != nil {
		return err
	}
	if maximum > 0 && initial > maximum {
		return fmt.Errorf("initial heap %d MB exceeds max heap %d MB", initial, maximum)
	}
	if maximum > 0 && int(server.Memory)-maximum < 256 {
		return fmt.Errorf("max heap %d MB must leave at least 256 MB of the %d MB server memory for JVM overhead", maximum, server.Memory)
	}
	if initial > 0 && int(server.Memory)-initial < 256 {
		return fmt.Errorf("initial heap %d MB must leave at least 256 MB of the %d MB server memory for JVM overhead", initial, server.Memory)
	}
	return nil
}

// Short UI form of a status enum: SERVER_STATUS_RUNNING -> RUNNING
func shortStatusName(status v1.ServerStatus) string {
	return strings.TrimPrefix(status.String(), "SERVER_STATUS_")
}
func (s *PropertiesService) applyPropertiesToRunningServer(reqCtx context.Context, server *v1.Server) {
	switch server.Status {
	case v1.ServerStatus_SERVER_STATUS_RUNNING, v1.ServerStatus_SERVER_STATUS_STARTING, v1.ServerStatus_SERVER_STATUS_UNHEALTHY, v1.ServerStatus_SERVER_STATUS_PAUSED:
		go func() {
			ctx, cancel := context.WithTimeout(detach(reqCtx), 30*time.Minute)
			defer cancel()
			if err := s.lifecycle.Restart(ctx, server.Id); err != nil {
				s.log.Error("Failed to restart server %s after config update: %v", server.Name, err)
			}
		}()
	}
}

// Maps updates onto fields by json name
func applyPropertyUpdates(config proto.Message, updates map[string]string) error {
	m := config.ProtoReflect()
	fields := m.Descriptor().Fields()
	for key, strValue := range updates {
		fd := fields.ByJSONName(key)
		if fd == nil {
			return fmt.Errorf("unknown property key %s", key)
		}
		if err := protometa.SetScalarString(m, fd, strValue); err != nil {
			return fmt.Errorf("invalid value for key %s: %v", key, err)
		}
	}
	return nil
}

// Reads one settings field by its property key
func propertyValueByKey(config proto.Message, key string) string {
	m := config.ProtoReflect()
	fd := m.Descriptor().Fields().ByJSONName(key)
	if fd == nil {
		return ""
	}
	value, _ := protometa.ScalarString(m, fd)
	return value
}

// Reads live file values for unmanaged default display
func serverFileProps(server *v1.Server) minecraft.PropertiesFile {
	props, err := minecraft.LoadPropertiesFile(server.DataPath)
	if err != nil {
		return nil
	}
	return props
}

func buildPropertyCategories(config proto.Message, fileProps minecraft.PropertiesFile) ([]*v1.PropertyCategory, error) {
	m := config.ProtoReflect()
	declared := protometa.Categories(m.Descriptor())
	categories := make([]*v1.PropertyCategory, len(declared))
	slugIndex := make(map[string]int, len(declared))
	for i, c := range declared {
		categories[i] = &v1.PropertyCategory{Name: c.Label, Properties: []*v1.ServerProperty{}}
		slugIndex[c.Slug] = i
	}

	for _, p := range protometa.Props(m.Descriptor()) {
		categoryIndex, ok := slugIndex[p.Meta.Category]
		if !ok {
			continue
		}

		key := p.Field.JSONName()
		value, set := protometa.ScalarString(m, p.Field)

		env := p.Meta.Env
		if env == "" {
			// Falls back to prop key for display
			env = p.Meta.Prop
		}
		label := p.Meta.Label
		if label == "" {
			label = key
		}

		prop := &v1.ServerProperty{
			Key:         key,
			Label:       label,
			Value:       value,
			Type:        p.Meta.Input,
			Description: p.Meta.Desc,
			Required:    p.Meta.Required,
			System:      p.Meta.System,
			Ephemeral:   p.Meta.Ephemeral,
			EnvVar:      env,
		}

		// Only set default when annotation specifies one
		if p.Meta.DefaultValue != "" {
			def := p.Meta.DefaultValue
			prop.DefaultValue = &def
		}

		// Unmanaged keys show their current file value instead
		if !set && p.Meta.Prop != "" {
			if current, ok := fileProps[p.Meta.Prop]; ok {
				prop.DefaultValue = &current
			}
		}

		if p.Meta.Input == "select" {
			prop.Options = p.Meta.Options
			// Pack loader choices derive from the loader registry
			if key == "modrinthLoader" {
				prop.Options = minecraft.PackLoaderNames()
			}
		}

		categories[categoryIndex].Properties = append(categories[categoryIndex].Properties, prop)
	}

	// Filter empty
	var nonEmptyCategories []*v1.PropertyCategory
	for _, cat := range categories {
		if len(cat.Properties) > 0 {
			nonEmptyCategories = append(nonEmptyCategories, cat)
		}
	}

	return nonEmptyCategories, nil
}
