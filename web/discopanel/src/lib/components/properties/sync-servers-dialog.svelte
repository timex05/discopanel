<script lang="ts">
	import { Dialog as DialogPrimitive } from 'bits-ui';
	import {
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ServerAvatar, StatusBadge, EmptyState } from '$lib/components/app';
	import { serversStore } from '$lib/stores/servers';
	import { notify } from '$lib/stores/activity.svelte';
	import { rpcClient, rpcErrorMessage, silentCallOptions } from '$lib/api/rpc-client';
	import {
		PreviewGlobalSettingsSyncRequestSchema,
		type SyncPropertyChange,
		type SyncServerPreview
	} from '$lib/proto/discopanel/v1/properties_pb';
	import { create } from '@bufbuild/protobuf';
	import { Search, Server as ServerIcon } from '@lucide/svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import type { Server } from '$lib/proto/discopanel/v1/storage_pb';

	interface Props {
		open?: boolean;
		onContinue: (serverIds: string[], onlyExplicit: boolean) => void;
	}

	let { open = $bindable(false), onContinue }: Props = $props();

	let servers = $state<Server[]>([]);
	let loading = $state(false);
	let previewError = $state('');
	let previews = $state<Record<string, SyncServerPreview>>({});
	let query = $state('');
	let selected = new SvelteSet<string>();
	let onlyExplicit = $state(true);
	let loadGeneration = 0;

	// Fresh selection each time the dialog opens
	$effect(() => {
		if (open) {
			query = '';
			servers = [];
			selected.clear();
			onlyExplicit = true;
			previews = {};
			previewError = '';
			load();
		} else {
			loadGeneration++;
		}
	});

	async function load() {
		const generation = ++loadGeneration;
		loading = true;
		try {
			const loadedServers = (await serversStore.fetchServers(true)) ?? [];
			if (generation !== loadGeneration) return;
			servers = loadedServers;
			if (loadedServers.length > 0) {
				const response = await rpcClient.properties.previewGlobalSettingsSync(
					create(PreviewGlobalSettingsSyncRequestSchema, {
						serverIds: loadedServers.map((server) => server.id)
					}),
					silentCallOptions
				);
				if (generation !== loadGeneration) return;
				previews = Object.fromEntries(
					response.previews.map((preview) => [preview.serverId, preview])
				);
			}
		} catch (error) {
			if (generation !== loadGeneration) return;
			previewError = rpcErrorMessage(error, 'Failed to load the sync preview');
			notify.error(previewError);
		} finally {
			if (generation === loadGeneration) loading = false;
		}
	}

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return servers;
		return servers.filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(q));
	});

	let allSelected = $derived(filtered.length > 0 && filtered.every((s) => selected.has(s.id)));
	let selectedReady = $derived(
		[...selected].every((id) => previews[id] && !serverError(previews[id]))
	);

	function serverError(preview: SyncServerPreview): string {
		return preview.error || (onlyExplicit ? preview.explicitError : preview.allError);
	}

	function changesFor(preview: SyncServerPreview | undefined): SyncPropertyChange[] {
		if (!preview) return [];
		return onlyExplicit ? preview.explicitChanges : preview.allChanges;
	}

	function valueText(value: string, set: boolean): string {
		if (!set) return 'Unset';
		return value === '' ? '(empty string)' : value;
	}

	function toggleAll() {
		if (allSelected) {
			for (const s of filtered) selected.delete(s.id);
		} else {
			for (const s of filtered) selected.add(s.id);
		}
	}

	function toggle(id: string) {
		if (selected.has(id)) selected.delete(id);
		else selected.add(id);
	}
</script>

<DialogPrimitive.Root bind:open>
	<DialogContent class="!max-w-2xl">
		<DialogHeader>
			<DialogTitle>Sync settings to servers</DialogTitle>
			<DialogDescription>
				Select the servers that receive the saved default settings.
			</DialogDescription>
		</DialogHeader>

		<div class="relative shrink-0">
			<Search class="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
			<Input placeholder="Search servers..." class="h-8 pl-8" bind:value={query} />
		</div>

		<div class="flex shrink-0 items-center justify-between">
			<span class="text-xs text-muted-foreground">
				{selected.size} of {servers.length} selected
			</span>
			<Button
				variant="ghost"
				size="sm"
				onclick={toggleAll}
				disabled={loading || filtered.length === 0}
			>
				{allSelected ? 'Deselect all' : 'Select all'}
			</Button>
		</div>

		<div class="max-h-[55vh] min-h-32 overflow-y-auto rounded-md border bg-muted/20 py-1">
			{#if loading}
				<div class="space-y-2 p-3">
					<Skeleton class="h-10 rounded-md" />
					<Skeleton class="h-10 rounded-md" />
					<Skeleton class="h-10 rounded-md" />
				</div>
			{:else if previewError}
				<p class="p-4 text-sm text-destructive">{previewError}</p>
			{:else if filtered.length === 0}
				<div class="p-4">
					<EmptyState
						icon={ServerIcon}
						title={servers.length === 0 ? 'No servers found' : 'No servers match'}
						description={servers.length === 0
							? 'Create a server first before syncing settings.'
							: `No servers match "${query}"`}
					/>
				</div>
			{:else}
				{#each filtered as server (server.id)}
					{@const preview = previews[server.id]}
					{@const changes = changesFor(preview)}
					<div class="border-b last:border-b-0">
						<div class="flex items-center gap-3 px-3 py-2">
							<Checkbox
								checked={selected.has(server.id)}
								onCheckedChange={() => toggle(server.id)}
								aria-label="Select {server.name}"
							/>
							<button
								class="flex min-w-0 flex-1 items-center gap-3 text-left"
								onclick={() => toggle(server.id)}
							>
								<ServerAvatar name={server.name} favicon={server.favicon} size="sm" />
								<span class="min-w-0 flex-1 truncate font-medium">{server.name}</span>
								<StatusBadge status={server.status} />
							</button>
							<span class="shrink-0 text-xs text-muted-foreground">
								{changes.length}
								{changes.length === 1 ? 'change' : 'changes'}
							</span>
						</div>
						{#if selected.has(server.id)}
							<div class="space-y-2 px-3 pb-3 pl-10">
								{#if !preview}
									<p class="text-xs text-destructive">Preview unavailable.</p>
								{:else if serverError(preview)}
									<p class="text-xs text-destructive">{serverError(preview)}</p>
								{:else if changes.length === 0}
									<p class="text-xs text-muted-foreground">No property values will change.</p>
								{:else}
									<p class="text-xs text-muted-foreground">Current → After sync</p>
									<div class="max-h-56 divide-y overflow-y-auto rounded-md border bg-background">
										{#each changes as change (change.key)}
											<div
												class="grid gap-1 px-2 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] sm:gap-3"
											>
												<span class="font-medium">{change.label}</span>
												<div class="grid min-w-0 grid-cols-[1fr_auto_1fr] items-start gap-2">
													<code
														class="min-w-0 break-all whitespace-pre-wrap text-muted-foreground"
														title="Current value"
														>{valueText(change.currentValue, change.currentSet)}</code
													>
													<span aria-hidden="true">→</span>
													<code class="min-w-0 break-all whitespace-pre-wrap" title="After sync"
														>{valueText(change.nextValue, change.nextSet)}</code
													>
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			{/if}
		</div>

		<div class="flex shrink-0 items-start gap-2 rounded-md border bg-muted/20 p-3">
			<Checkbox id="only-explicit" bind:checked={onlyExplicit} class="mt-0.5" />
			<div class="space-y-0.5">
				<Label for="only-explicit" class="text-sm font-medium">
					Only update explicitly set settings
				</Label>
				<p class="text-xs text-muted-foreground">
					When off, unset defaults clear matching server properties. When on, properties with unset
					defaults keep their current values. The external host port and server resource limits are
					not changed.
				</p>
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
			<Button
				onclick={() => onContinue([...selected], onlyExplicit)}
				disabled={loading || selected.size === 0 || !selectedReady || !!previewError}
			>
				Continue ({selected.size})
			</Button>
		</DialogFooter>
	</DialogContent>
</DialogPrimitive.Root>
