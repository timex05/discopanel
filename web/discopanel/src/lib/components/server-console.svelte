<script lang="ts">
	import { onDestroy, onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { rpcClient, silentCallOptions } from '$lib/api/rpc-client';
	import { create } from '@bufbuild/protobuf';
	import { timestampDate } from '@bufbuild/protobuf/wkt';
	import type { Server, ServerAction } from '$lib/proto/discopanel/v1/storage_pb';
	import { ServerStatus, ServerActionKindSchema } from '$lib/proto/discopanel/v1/storage_pb';
	import { enumLabel } from '$lib/proto-meta';
	import type { LogEntry } from '$lib/proto/discopanel/v1/server_pb';
	import {
		GetServerLogsRequestSchema,
		ClearServerLogsRequestSchema,
		SendCommandRequestSchema,
		UploadToMCLogsRequestSchema
	} from '$lib/proto/discopanel/v1/server_pb';
	import { Button } from '$lib/components/ui/button';
	import { notify } from '$lib/stores/activity.svelte';
	import {
		Send,
		Loader2,
		Download,
		Share,
		Trash2,
		ArrowDown,
		ChevronDown,
		Activity,
		Terminal,
		ChevronRight,
		X,
		Info,
		AlertCircle,
		ExternalLink,

		Search

	} from '@lucide/svelte';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Command, CommandItem, CommandList } from '$lib/components/ui/command';
	import { isModLoaderCompatible } from '$lib/command-completion/completions';
	import type Completions from '$lib/command-completion/completions';
	import type { BaseCommand } from '$lib/command-completion/completions';
	import { ModLoaderSchema } from '$lib/proto/discopanel/v1/storage_pb';
	import { mode } from 'mode-watcher';
	import { parseMinecraftColors, themedAnsiConverter } from '$lib/ansi-console';
	import { statusMeta, isUp, TONE_BG } from '$lib/server-status';
	import { wsClient } from '$lib/stores/websocket.svelte';
	import { registerRefresh } from '$lib/stores/refresh';
	import { copyToClipboard } from '$lib/utils/clipboard';
	import { Input } from './ui/input';
	import { SvelteSet } from 'svelte/reactivity';

	let ansiConverter = $derived(themedAnsiConverter(mode.current));

	let { server, active = false }: { server: Server; active?: boolean } = $props();

	let logEntries = $state<LogEntry[]>([]);
	let command = $state('');
	let loading = $state(false);
	let commandInFlight = $state(false);
	let commandTimeout: ReturnType<typeof setTimeout> | null = null;
	let autoScroll = $state(true);
	let unseenLines = $state(0);
	let scrollAreaRef = $state<HTMLDivElement | null>(null);
	let inputRef = $state<HTMLInputElement | null>(null);
	let tailLines = $state(500);
	const MAX_LOG_ENTRIES = 5000;
	const TAIL_OPTIONS = [100, 500, 1000, 2000];

	// Second channel holds everything DiscoPanel did to the server
	let channel = $state<'server' | 'actions'>('server');
	const CHANNELS = [
		{ id: 'server', label: 'server', icon: Terminal },
		{ id: 'actions', label: 'activity', icon: Activity }
	] as const;
	let actions = $state<ServerAction[]>([]);
	let actionsLoaded = $state(false);
	let highlightMs = $state(0);
	let sourceFilter = $state('all');
	let expandedId = $state<bigint | null>(null);

	// Subsystems get one look, users another
	const AUTOMATION_SOURCES = new Set([
		'panel',
		'runtime',
		'crash doctor',
		'scheduler',
		'provisioner',
		'mod check',
		'autopause',
		'autostop',
		'autostart',
		'wake-on-connect'
	]);

	let actionSources = $derived.by(() => {
		const seen = new SvelteSet<string>();
		for (const a of actions) if (a.source) seen.add(a.source);
		return [...seen].sort();
	});
	let traceFilter = $state('');
	let visibleActions = $derived(
		actions.filter(
			(a) =>
				(sourceFilter === 'all' || a.source === sourceFilter) &&
				(traceFilter === '' || a.traceId === traceFilter)
		)
	);

	function toggleExpanded(a: ServerAction) {
		expandedId = expandedId === a.id ? null : a.id;
	}

	function actionDetails(a: ServerAction): [string, string][] {
		const rows: [string, string][] = [];
		if (a.kind) rows.push(['action', enumLabel(ServerActionKindSchema, a.kind)]);
		for (const key of Object.keys(a.attrs).sort()) rows.push([key, a.attrs[key]]);
		if (a.traceId) rows.push(['trace', a.traceId]);
		return rows;
	}

	// Repins so the pinned-view effect lands on the newest line
	function switchChannel(next: 'server' | 'actions') {
		if (channel === next) return;
		channel = next;
		autoScroll = true;
		unseenLines = 0;
		expandedId = null;
	}

	// Health dialog deep links pick the channel and highlight window
	$effect(() => {
		const ch = page.url.searchParams.get('channel');
		const hl = page.url.searchParams.get('hl');
		untrack(() => {
			if (ch === 'actions') channel = 'actions';
			highlightMs = hl ? Number(hl) : 0;
		});
	});

	$effect(() => {
		if (!active || channel !== 'actions') return;
		untrack(() => loadActions(true));
		const timer = setInterval(() => loadActions(false), 5000);
		return () => clearInterval(timer);
	});

	async function loadActions(initial: boolean) {
		try {
			const last = actions.length > 0 ? actions[actions.length - 1].id : 0n;
			const res = await rpcClient.server.getServerActions(
				{
					id: server.id,
					afterId: initial ? 0n : last
				},
				silentCallOptions
			);
			if (initial) {
				// Deep links inspect history, unpin before rows render
				if (highlightMs > 0) autoScroll = false;
				actions = res.actions;
			} else if (res.actions.length > 0) {
				actions = [...actions, ...res.actions];
			}
			actionsLoaded = true;
			if (initial) queueMicrotask(scrollToActionAnchor);
		} catch {
			// Poll silently, the toggle shows the empty state
		}
	}

	function actionHighlighted(a: ServerAction) {
		if (highlightMs <= 0 || !a.timestamp) return false;
		return timestampDate(a.timestamp).getTime() >= highlightMs;
	}

	// Lands on the highlight line, else pins to newest
	function scrollToActionAnchor() {
		if (!scrollAreaRef) return;
		const target = scrollAreaRef.querySelector('.action-highlight');
		if (target) {
			target.scrollIntoView({ block: 'center' });
		} else {
			autoScroll = true;
			scrollAreaRef.scrollTop = scrollAreaRef.scrollHeight;
		}
	}

	function actionTime(a: ServerAction) {
		if (!a.timestamp) return '';
		return timestampDate(a.timestamp).toLocaleString(undefined, {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
	}

	// Command history navigated with arrow keys
	let history: string[] = [];
	let historyIndex = $state(-1);
	let draftCommand = '';

	let wsConnectionState = $derived(wsClient.state.connectionState);
	let meta = $derived(statusMeta(server.status));
	let canSend = $derived(isUp(server.status));

	let cleanupHandlers: (() => void)[] = [];
	let previousServerId = server.id;

	onDestroy(() => {
		untrack(() => cleanupWebSocket());
		if (commandTimeout) clearTimeout(commandTimeout);
	});

	// Follow the active tab to hold the subscription
	$effect(() => {
		if (active) {
			untrack(() => setupWebSocket());
		} else {
			untrack(() => cleanupWebSocket());
		}
	});

	$effect(() => {
		if (!active) return;
		return registerRefresh(fetchLogs);
	});

	// Swap subscriptions when viewing a different server
	$effect(() => {
		const currentServerId = server.id;
		if (currentServerId !== previousServerId) {
			const oldServerId = previousServerId;
			previousServerId = currentServerId;

			untrack(() => {
				wsClient.unsubscribe(oldServerId);
				logEntries = [];
				actions = [];
				actionsLoaded = false;
				sourceFilter = 'all';
				expandedId = null;
				command = '';
				unseenLines = 0;

				if (active) {
					wsClient.subscribe(currentServerId, tailLines);
					if (channel === 'actions') loadActions(true);
				}
			});
		}
	});

	function setupWebSocket() {
		cleanupWebSocket();
		wsClient.connect();

		const unsubLogs = wsClient.onLogs((serverId, logs) => {
			if (serverId === server.id) {
				logEntries = logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs;
			}
		});

		const unsubLogEntry = wsClient.onLogEntry((serverId, logs) => {
			if (serverId === server.id && logs.length > 0) {
				const combined = [...logEntries, ...logs];
				logEntries =
					combined.length > MAX_LOG_ENTRIES ? combined.slice(-MAX_LOG_ENTRIES) : combined;
				if (!autoScroll) unseenLines += logs.length;
			}
		});

		const unsubCommandResult = wsClient.onCommandResult((result) => {
			if (result.serverId === server.id) {
				clearCommandInFlight();
				if (!result.success) {
					notify.error(result.error || 'Failed to execute command');
				}
			}
		});

		cleanupHandlers = [unsubLogs, unsubLogEntry, unsubCommandResult];
		wsClient.subscribe(server.id, tailLines);
	}

	function cleanupWebSocket() {
		wsClient.unsubscribe(server.id);
		cleanupHandlers.forEach((cleanup) => cleanup());
		cleanupHandlers = [];
	}

	// Keeps the view pinned on the active channel
	$effect(() => {
		const count = channel === 'actions' ? visibleActions.length : logEntries.length;
		if (count > 0 && autoScroll && scrollAreaRef) {
			queueMicrotask(() => {
				if (scrollAreaRef) {
					scrollAreaRef.scrollTop = scrollAreaRef.scrollHeight;
				}
			});
		}
	});

	function handleScroll() {
		if (!scrollAreaRef) return;

		const { scrollTop, scrollHeight, clientHeight } = scrollAreaRef;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 5;

		if (isAtBottom && !autoScroll) {
			autoScroll = true;
			unseenLines = 0;
		} else if (!isAtBottom && autoScroll) {
			autoScroll = false;
		}
	}

	function jumpToBottom() {
		if (!scrollAreaRef) return;
		scrollAreaRef.scrollTop = scrollAreaRef.scrollHeight;
		autoScroll = true;
		unseenLines = 0;
	}

	async function fetchLogs() {
		if (loading || commandInFlight) return;
		if (server.status === ServerStatus.STOPPED) return;

		loading = true;
		try {
			const request = create(GetServerLogsRequestSchema, {
				id: server.id,
				tail: tailLines
			});
			const response = await rpcClient.server.getServerLogs(request);
			const logs = response.logs || [];
			logEntries = logs.length > MAX_LOG_ENTRIES ? logs.slice(-MAX_LOG_ENTRIES) : logs;
		} catch (error) {
			console.error('Failed to fetch logs:', error);
		} finally {
			loading = false;
		}
	}

	// Clears the in flight flag and its fallback timer
	function clearCommandInFlight() {
		if (commandTimeout) {
			clearTimeout(commandTimeout);
			commandTimeout = null;
		}
		commandInFlight = false;
	}

	function navigateHistory(direction: -1 | 1) {
		if (history.length === 0) return;
		if (historyIndex === -1) {
			if (direction === 1) return;
			draftCommand = command;
			historyIndex = history.length - 1;
		} else {
			const next = historyIndex + direction;
			if (next >= history.length) {
				historyIndex = -1;
				command = draftCommand;
				return;
			}
			historyIndex = Math.max(next, 0);
		}
		command = history[historyIndex] ?? '';
	}

	// Command Completion
	type SuggestionItem = {
		value: string;
		ref: HTMLElement | null;
	};

	let completions = $state<Completions | undefined>(undefined);
	let baseCmds = $state<BaseCommand[]>([]);
	let forceDisabled = $state(false);
	let enabled = $state(true);
	let cmdCEnabled = $derived(!forceDisabled && enabled);
	let open = $state(false);
	let showCmdCInfo = $state(false);
	let suggestions = $state<SuggestionItem[]>([]);
	let activeSuggestionIndex = $state(-1);
	let cmdDropdown = $state<HTMLElement | null>(null);
	let commandDocsUrl = $state<string | undefined>(undefined);
	let cmdValid = $state(true);
	let searchQuery = $state('');
	let selectedCommand = $state<typeof baseCmds[number] | null>(null);

	let filteredCmds = $derived(
    	baseCmds
        	.filter((cmd) => cmd.name.toLowerCase().includes(searchQuery.toLowerCase()))
        	.sort((a, b) => a.name.localeCompare(b.name))
	);

	$effect(() => {
        if (filteredCmds.length > 0) {
            if (!selectedCommand || !filteredCmds.some((c) => c.name === selectedCommand?.name)) {
                selectedCommand = filteredCmds[0];
            }
        } else {
            selectedCommand = null;
        }
    });

	let oldStatus = server.status;
	$effect(() => {
		if (server.status !== ServerStatus.RUNNING && server.status !== ServerStatus.UNHEALTHY) {
			completions = undefined;
			baseCmds = [];
		}

		if (server.status !== oldStatus) {
			oldStatus = server.status;
			if (server.status === ServerStatus.RUNNING || server.status === ServerStatus.UNHEALTHY) {
				initCommandCompletion();
			}
		}
	});

	$effect(() => {
		let cancelled = false;

		(async () => {
			if (!cmdCEnabled || !completions || !command.trim()) {
				cmdValid = true;
				return;
			}

			const result = await completions.isCommandValid(command);
			if (!cancelled) {
				cmdValid = result;
			}
		})();

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		if (!open || activeSuggestionIndex < 0) return;

		queueMicrotask(() => {
			suggestions[activeSuggestionIndex]?.ref?.scrollIntoView({ block: 'nearest' });
		});
	});

	// function getCommandCompletionAvailabilityLabel() {
	// 	if (forceDisabled) return 'Unavailable';
	// 	if (server.status === ServerStatus.STARTING) return 'Server is starting...';
	// 	if (server.status !== ServerStatus.RUNNING && server.status !== ServerStatus.UNHEALTHY)
	// 		return 'Server must be running.';
	// 	return completions ? 'Available' : 'Loading...';
	// }

	async function sendSilentCommandWithReturn(cmd: string): Promise<string> {
		const request = create(SendCommandRequestSchema, {
			id: server.id,
			command: cmd,
			silent: true
		});
		const response = await rpcClient.server.sendCommand(request);
		return response.output;
	}

	function resetCommandCompletionState() {
		completions = undefined;
		baseCmds = [];
		forceDisabled = false;
		open = false;
		suggestions = [];
		activeSuggestionIndex = -1;
		cmdDropdown = null;
	}

	async function initCommandCompletion() {
		resetCommandCompletionState();

		try {
			const modLoaderCompatibleResult = await isModLoaderCompatible(
				server.modLoader,
				server.mcVersion
			);

			if (!modLoaderCompatibleResult.compatible) {
				forceDisabled = true;
			}
			commandDocsUrl = modLoaderCompatibleResult.commandDocsUrl;

			if (
				!forceDisabled &&
				(server.status === ServerStatus.RUNNING || server.status === ServerStatus.UNHEALTHY) &&
				modLoaderCompatibleResult.completionClass
			) {
				completions =
					await modLoaderCompatibleResult.completionClass.create(sendSilentCommandWithReturn);
				try {
					if (completions) {
						baseCmds = await completions.getBaseCommands();
						updateSuggestions();
					}
				} catch (e) {
					baseCmds = [];
					console.error('Failed to load base commands', e);
				}
			}
		} catch (error) {
			console.error('Failed to fetch command completions:', error);
		}
	}

	onMount(async () => {
		await initCommandCompletion();
	});

	async function updateSuggestions() {
		if (!cmdCEnabled || !completions) return;
		const visibleSuggestions = await completions.getPossibleCompletions(command);
		suggestions = visibleSuggestions.map((result) => ({ value: result.value, ref: null }));
		activeSuggestionIndex = suggestions.length > 0 ? 0 : -1;
	}

	async function applyCompletion(suggestion: string) {
		if (command.split(' ').length <= 1) {
			command = suggestion;
			open = true;
			await updateSuggestions();
		} else {
			const parts = command.split(' ');
			let newCommand = parts.slice(0, -1).concat(suggestion).join(' ');
			command = newCommand;
			open = true;
			await updateSuggestions();
		}
	}

	function focusDropdown(index: number) {
		if (!suggestions.length) return;
		activeSuggestionIndex = Math.max(0, Math.min(index, suggestions.length - 1));
		cmdDropdown?.focus();
	}

	function handleDropdownKeyDown(e: KeyboardEvent) {
		if (!suggestions.length) return;
		e.preventDefault();

		switch (e.key) {
			case 'ArrowDown':
				activeSuggestionIndex =
					activeSuggestionIndex < suggestions.length - 1 ? activeSuggestionIndex + 1 : 0;
				break;
			case 'ArrowUp':
				activeSuggestionIndex =
					activeSuggestionIndex > 0 ? activeSuggestionIndex - 1 : suggestions.length - 1;
				break;
			case 'Enter':
			case 'Tab':
				if (activeSuggestionIndex >= 0) {
					applyCompletion(suggestions[activeSuggestionIndex].value);
					inputRef?.focus();
				}
				break;
			case 'Escape':
				open = false;
				activeSuggestionIndex = -1;
				inputRef?.focus();
				break;
			default:
				activeSuggestionIndex = -1;
				inputRef?.focus();
				if (e.key.length === 1) command += e.key;
				updateSuggestions();
				break;
		}
	}

	function handleCmdFocusOut(event: FocusEvent) {
		if (forceDisabled) return;
		const nextFocused = event.relatedTarget as Node | null;
		if (nextFocused && cmdDropdown?.contains(nextFocused)) {
			return;
		}
		open = false;
		activeSuggestionIndex = -1;
	}

	function handleInputKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'Enter':
				sendCommand();
				open = false;
				suggestions = [];
				activeSuggestionIndex = -1;
				break;
			case 'Tab':
				if (!cmdCEnabled) return;
				e.preventDefault();
				if (suggestions.length > 0) {
					applyCompletion(suggestions[0].value);
				}
				break;
			case 'Escape':
				open = false;
				break;
			case 'ArrowUp':
				e.preventDefault();
				if (open && suggestions.length > 0) {
					focusDropdown(0);
					return;
				}
				navigateHistory(-1);
				break;
			case 'ArrowDown':
				e.preventDefault();
				if (open && suggestions.length > 0) {
					focusDropdown(suggestions.length - 1);
					return;
				}
				navigateHistory(1);
				break;
			default:
				open = true;
				break;
		}
	}

	async function onCmdInputFocus() {
		if (!cmdCEnabled) return;
		open = true;
		await updateSuggestions();
	}

	async function sendCommand() {
		if (!command.trim() || !canSend) return;

		commandInFlight = true;
		if (commandTimeout) clearTimeout(commandTimeout);
		// Frees the flag if the socket drops mid command
		commandTimeout = setTimeout(() => clearCommandInFlight(), 10000);
		const cmdToSend = command;
		command = '';
		if (history[history.length - 1] !== cmdToSend) {
			history.push(cmdToSend);
			if (history.length > 100) history.shift();
		}
		historyIndex = -1;
		draftCommand = '';

		// Prefer the socket and fall back to rpc
		if (wsClient.isReady) {
			wsClient.sendCommand(server.id, cmdToSend);
		} else {
			try {
				const request = create(SendCommandRequestSchema, {
					id: server.id,
					command: cmdToSend
				});
				const response = await rpcClient.server.sendCommand(request);
				if (!response.success) {
					notify.error(response.error || 'Failed to execute command');
				}
			} catch (error) {
				console.error(
					'Failed to send command: ' + (error instanceof Error ? error.message : 'Unknown error')
				);
			} finally {
				clearCommandInFlight();
			}
		}
	}

	async function clearLogs() {
		try {
			const request = create(ClearServerLogsRequestSchema, {
				id: server.id
			});
			await rpcClient.server.clearServerLogs(request, silentCallOptions);
			logEntries = [];
			unseenLines = 0;
			notify.success('Console cleared');
		} catch (error) {
			notify.error(
				'Failed to clear console: ' + (error instanceof Error ? error.message : 'Unknown error')
			);
		}
	}

	let uploading = $state(false);

	async function uploadToMCLogs() {
		if (uploading) return;
		uploading = true;
		let url = '';
		try {
			const request = create(UploadToMCLogsRequestSchema, { id: server.id });
			const response = await rpcClient.server.uploadToMCLogs(request, silentCallOptions);
			url = response.url;
		} catch (error) {
			notify.error(
				'Failed to upload to mclo.gs: ' + (error instanceof Error ? error.message : 'Unknown error')
			);
		} finally {
			uploading = false;
		}
		if (!url) return;
		// Upload worked, copying is only a bonus
		const copied = await copyToClipboard(url);
		notify.success(copied ? 'mclo.gs link copied' : 'Logs uploaded, copy this link', {
			description: url,
			duration: 15000
		});
	}

	function downloadLogs() {
		const logText = logEntries.map((entry) => entry.message).join('\n');
		const blob = new Blob([logText], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${server.name}-logs-${new Date().toISOString()}.txt`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		notify.success('Logs downloaded');
	}

	function handleTailChange() {
		// Resubscribe so the socket honors the new tail
		if (wsClient.isReady) {
			wsClient.unsubscribe(server.id);
			wsClient.subscribe(server.id, tailLines);
		} else {
			fetchLogs();
		}
	}

	let streamLive = $derived(wsConnectionState === 'authenticated');
	let streamLabel = $derived(
		wsConnectionState === 'authenticated'
			? 'Live stream connected'
			: wsConnectionState === 'connecting'
				? 'Connecting to stream...'
				: wsConnectionState === 'connected'
					? 'Authenticating stream...'
					: 'Stream offline, polling instead'
	);
</script>

<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-terminal shadow-sm transition-colors duration-300"
>
	<div
		class="flex h-9.5 shrink-0 items-stretch gap-3 border-b border-terminal-foreground/8 bg-terminal-foreground/4 pr-2 pl-3 transition-colors duration-300"
	>
		<div class="flex min-w-0 items-center gap-2 py-2">
			<span class="relative flex size-2 shrink-0">
				{#if meta.transitional}
					<span
						class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 {TONE_BG[
							meta.tone
						]}"
					></span>
				{/if}
				<span class="relative inline-flex size-2 rounded-full {TONE_BG[meta.tone]}"></span>
			</span>
			<span
				class="truncate font-mono text-xs font-medium tracking-wide text-terminal-foreground/85"
			>
				{server.name}
			</span>
			<span class="shrink-0 font-mono text-xs text-terminal-foreground/40"
				>{meta.label.toLowerCase()}</span
			>
		</div>

		<Tooltip.Root>
			<Tooltip.Trigger class="self-center">
				<span
					class="inline-flex items-center gap-1.5 rounded-full border border-terminal-foreground/10 px-2 py-0.5 font-mono text-[10px] tracking-wide {streamLive
						? 'text-status-ok'
						: 'text-terminal-foreground/40'}"
				>
					<span
						class="size-1.5 rounded-full {streamLive
							? 'bg-status-ok'
							: 'bg-terminal-foreground/30'}"
						class:animate-pulse={streamLive}
					></span>
					{streamLive ? 'live' : 'polling'}
				</span>
			</Tooltip.Trigger>
			<Tooltip.Content>{streamLabel}</Tooltip.Content>
		</Tooltip.Root>

		<nav class="flex shrink-0 items-end gap-1 pt-1.5" role="tablist" aria-label="Console channels">
			{#each CHANNELS as tab (tab.id)}
				<button
					class="-mb-px flex items-center gap-1.5 rounded-t-md border px-3 pt-1 pb-1.5 font-mono text-[11px] transition-colors {channel ===
					tab.id
						? 'border-terminal-foreground/10 border-b-transparent bg-terminal text-terminal-foreground'
						: 'border-transparent text-terminal-foreground/40 hover:text-terminal-foreground/70'}"
					role="tab"
					aria-selected={channel === tab.id}
					onclick={() => switchChannel(tab.id)}
				>
					<tab.icon class="size-3" />
					{tab.label}
				</button>
			{/each}
		</nav>

		<div class="ml-auto flex shrink-0 items-center gap-2 py-1.5">
			{#if channel === 'actions'}
				{#if traceFilter}
					<button
						class="flex h-6 items-center gap-1 rounded-md border border-amber-600/40 px-2 font-mono text-[11px] text-amber-700/90 dark:border-amber-400/30 dark:text-amber-300/80"
						title="Clear incident filter"
						onclick={() => (traceFilter = '')}
					>
						{traceFilter}
						<X class="size-3" />
					</button>
				{/if}
				<div
					class="flex h-6 items-center rounded-md border border-terminal-foreground/10 pl-2 font-mono text-[11px]"
					title="Filter by source"
				>
					<span class="text-terminal-foreground/40">Source:</span>
					<span class="relative flex h-full items-center">
						<select
							bind:value={sourceFilter}
							class="h-full appearance-none bg-transparent pr-5 pl-1.5 font-mono text-[11px] text-terminal-foreground/70 focus:outline-none"
						>
							<option value="all" class="bg-terminal">all</option>
							{#each actionSources as source (source)}
								<option value={source} class="bg-terminal">{source}</option>
							{/each}
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-1.5 size-3 text-terminal-foreground/40"
						/>
					</span>
				</div>
			{:else}
				<div
					class="flex h-6 items-center rounded-md border border-terminal-foreground/10 pl-2 font-mono text-[11px]"
					title="Lines loaded / lines of history to keep"
				>
					<span class="text-terminal-foreground/40">Lines:</span>
					<span class="px-1.5 text-terminal-foreground/70 tabular-nums">{logEntries.length}</span>
					<span class="text-terminal-foreground/25">/</span>
					<span class="relative flex h-full items-center">
						<select
							bind:value={tailLines}
							onchange={handleTailChange}
							class="h-full appearance-none bg-transparent pr-5 pl-1.5 font-mono text-[11px] text-terminal-foreground/70 tabular-nums focus:outline-none"
						>
							{#each TAIL_OPTIONS as option (option)}
								<option value={option} class="bg-terminal">{option}</option>
							{/each}
						</select>
						<ChevronDown
							class="pointer-events-none absolute right-1.5 size-3 text-terminal-foreground/40"
						/>
					</span>
				</div>
				<div class="flex items-center gap-0.5 border-l border-terminal-foreground/10 pl-2">
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="icon"
								variant="ghost"
								onclick={() => {
									showCmdCInfo = true;
									if (
										!completions &&
										(server.status === ServerStatus.RUNNING ||
											server.status === ServerStatus.UNHEALTHY)
									) {
										initCommandCompletion();
									}
								}}
								class="size-6.5 text-terminal-foreground/45 hover:bg-terminal-foreground/10 hover:text-terminal-foreground"
							>
								<Info class="size-3.5" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Available Commands</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="icon"
								variant="ghost"
								onclick={uploadToMCLogs}
								disabled={uploading || logEntries.length === 0}
								class="size-6.5 text-terminal-foreground/45 hover:bg-terminal-foreground/10 hover:text-terminal-foreground"
							>
								{#if uploading}
									<Loader2 class="size-3.5 animate-spin" />
								{:else}
									<Share class="size-3.5" />
								{/if}
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Share via mclo.gs</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="icon"
								variant="ghost"
								onclick={downloadLogs}
								disabled={logEntries.length === 0}
								class="size-6.5 text-terminal-foreground/45 hover:bg-terminal-foreground/10 hover:text-terminal-foreground"
							>
								<Download class="size-3.5" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Download logs</Tooltip.Content>
					</Tooltip.Root>
					<Tooltip.Root>
						<Tooltip.Trigger>
							<Button
								size="icon"
								variant="ghost"
								onclick={clearLogs}
								disabled={logEntries.length === 0}
								class="size-6.5 text-terminal-foreground/45 hover:bg-terminal-foreground/10 hover:text-terminal-foreground"
							>
								<Trash2 class="size-3.5" />
							</Button>
						</Tooltip.Trigger>
						<Tooltip.Content>Clear console</Tooltip.Content>
					</Tooltip.Root>
				</div>
			{/if}
		</div>
	</div>

	<div class="relative min-h-48 flex-1">
		<div
			class="absolute inset-0 overflow-x-auto overflow-y-auto px-4 py-3"
			bind:this={scrollAreaRef}
			onscroll={handleScroll}
		>
			{#if channel === 'actions'}
				{#if visibleActions.length === 0}
					<div
						class="flex h-full flex-col items-center justify-center gap-1.5 text-terminal-foreground/35"
					>
						<Activity class="size-6" />
						<p class="font-mono text-sm">No activity yet</p>
						<p class="font-mono text-xs">
							{actionsLoaded ? 'Starts, stops, repairs, and mod changes appear here' : 'Loading...'}
						</p>
					</div>
				{:else}
					<div class="font-mono text-xs leading-relaxed text-terminal-foreground">
						{#each visibleActions as a (a.id)}
							{@const details = actionDetails(a)}
							<button
								class="action-line flex w-full items-baseline gap-2 text-left break-words whitespace-pre-wrap {actionHighlighted(
									a
								)
									? 'action-highlight'
									: ''}"
								onclick={() => toggleExpanded(a)}
							>
								<ChevronRight
									class="size-3 shrink-0 self-center text-terminal-foreground/30 transition-transform {expandedId ===
									a.id
										? 'rotate-90'
										: ''} {details.length === 0 ? 'invisible' : ''}"
								/>
								<span class="shrink-0 text-terminal-foreground/40">{actionTime(a)}</span>
								<span
									class="shrink-0 rounded border px-1 text-[10px] tracking-wide uppercase {AUTOMATION_SOURCES.has(
										a.source
									)
										? 'border-terminal-foreground/10 text-terminal-foreground/50'
										: 'border-sky-600/40 text-sky-700/90 dark:border-sky-400/30 dark:text-sky-300/80'}"
								>
									{a.source}
								</span>
								<span>{a.message}</span>
							</button>
							{#if expandedId === a.id && details.length > 0}
								<div class="action-detail ml-9 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
									{#each details as [key, value] (key)}
										<span class="text-terminal-foreground/40">{key}</span>
										{#if key === 'trace'}
											<button
												class="w-fit break-all text-amber-700/90 hover:underline dark:text-amber-300/80"
												title="Show only this incident"
												onclick={() => (traceFilter = value)}
											>
												{value}
											</button>
										{:else}
											<span class="break-all text-terminal-foreground/70">{value}</span>
										{/if}
									{/each}
								</div>
							{/if}
						{/each}
					</div>
				{/if}
			{:else if logEntries.length === 0}
				<div
					class="flex h-full flex-col items-center justify-center gap-1.5 text-terminal-foreground/35"
				>
					<ChevronRight class="size-6" />
					<p class="font-mono text-sm">No output</p>
					<p class="font-mono text-xs">
						{[ServerStatus.STOPPED, ServerStatus.ERROR].includes(server.status)
							? 'Start the server to see logs here'
							: 'Waiting for output...'}
					</p>
				</div>
			{:else}
				<div class="font-mono text-xs leading-relaxed text-terminal-foreground">
					{#each logEntries as entry, i (i)}
						<div
							class="log-line break-all whitespace-pre-wrap"
							data-type={entry.source === 'command' || entry.source === 'command_output'
								? entry.source
								: entry.level}
						>
							<!-- eslint-disable-next-line svelte/no-at-html-tags -->
							{@html ansiConverter.toHtml(parseMinecraftColors(entry.message))}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		{#if !autoScroll}
			<button
				class="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-terminal-foreground/15 bg-terminal/95 px-3 py-1 font-mono text-xs text-terminal-foreground/80 shadow-lg backdrop-blur-sm transition-colors hover:bg-terminal-foreground/10"
				onclick={jumpToBottom}
			>
				<ArrowDown class="size-3" />
				{#if channel === 'server' && unseenLines > 0}
					{unseenLines} new {unseenLines === 1 ? 'line' : 'lines'}
				{:else}
					latest
				{/if}
			</button>
		{/if}
	</div>

	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="relative flex shrink-0 cursor-text items-center gap-2 border-t border-terminal-foreground/8 bg-terminal-foreground/4 px-3.5 py-2.5 transition-colors duration-300"
		class:hidden={channel === 'actions'}
		onclick={() => inputRef?.focus()}
	>
		<!-- Floating Command Completion -->
		{#if !forceDisabled && enabled && open && suggestions.length > 0}
			<div
				class="absolute bottom-full left-0 mb-2 w-full z-50 rounded-md border border-terminal-foreground/15 bg-terminal shadow-xl"
				bind:this={cmdDropdown}
				tabindex="-1"
				onkeydown={handleDropdownKeyDown}
			>
				<Command>
					<CommandList class="max-h-[150px]">
						{#each suggestions as suggestion, i (suggestion.value)}
							<CommandItem
								bind:ref={suggestion.ref}
								onclick={() => applyCompletion(suggestion.value)}
								class="font-mono text-sm {i === activeSuggestionIndex
									? 'bg-terminal-foreground/10 text-terminal-foreground'
									: 'text-terminal-foreground/80'}"
							>
								{suggestion.value}
							</CommandItem>
						{/each}
					</CommandList>
				</Command>
			</div>
		{/if}

		<span
			class="shrink-0 font-mono text-sm font-semibold {canSend
				? (!cmdValid && command.trim().length > 0
					? 'text-status-danger'
					: 'text-status-ok')
				: 'text-terminal-foreground/25'}"
		>
			❯
		</span>
		<input
			type="text"
			bind:this={inputRef}
			placeholder={canSend
				? 'Type a command, ↑ for history'
				: 'Server must be running to send commands'}
			bind:value={command}
			disabled={!canSend}
			onkeydown={handleInputKeydown}
			oninput={updateSuggestions}
			onfocus={onCmdInputFocus}
			onfocusout={handleCmdFocusOut}
			spellcheck="false"
			autocomplete="off"
			class="min-w-0 flex-1 bg-transparent font-mono text-sm text-terminal-foreground outline-none placeholder:text-terminal-foreground/30 disabled:cursor-not-allowed"
		/>
		<Button
			onclick={sendCommand}
			disabled={!canSend || !command.trim()}
			size="sm"
			variant="ghost"
			class="h-7 shrink-0 gap-1.5 px-2.5 font-mono text-xs text-terminal-foreground/60 hover:bg-terminal-foreground/10 hover:text-terminal-foreground disabled:text-terminal-foreground/20"
		>
			<Send class="size-3" />
			run
		</Button>
	</div>
</div>

<Dialog.Root bind:open={showCmdCInfo}>
    <Dialog.Content 
    style="width: 80vw !important; max-width: 1600px !important;" 
    class="h-[85vh] flex flex-col p-6 overflow-hidden"
>
        <Dialog.Header class="shrink-0">
            <Dialog.Title>Available Commands</Dialog.Title>
            <Dialog.Description>
                {#if forceDisabled}
                    No commands loaded.
				{:else}
                    Browse the available commands and open the documentation.
					<p class="text-sm italic">Note: There might be more commands available than shown here, depending on the server configuration and installed mods/plugins.</p>
				{/if}
            </Dialog.Description>
        </Dialog.Header>

        <div class="space-y-4 py-2 flex-1 min-h-0 flex flex-col overflow-hidden">
            <!-- <div class="grid shrink-0 gap-2 rounded-lg border border-terminal-foreground/15 bg-terminal-foreground/4 p-4 sm:grid-cols-3">
                <div>
                    <p class="text-xs uppercase tracking-wide text-terminal-foreground/50">Modloader</p>
                    <p class="mt-1 text-sm text-terminal-foreground">
                        {enumLabel(ModLoaderSchema, server.modLoader)}
                    </p>
                </div>
                <div>
                    <p class="text-xs uppercase tracking-wide text-terminal-foreground/50">Version</p>
                    <p class="mt-1 text-sm text-terminal-foreground">{server.mcVersion}</p>
                </div>
                <div>
                    <p class="text-xs uppercase tracking-wide text-terminal-foreground/50">Status</p>
                    <p class="mt-1 text-sm font-medium {forceDisabled ? 'text-status-danger' : 'text-status-ok'}">
                        {getCommandCompletionAvailabilityLabel()}
                    </p>
                </div>
            </div> -->

            {#if forceDisabled}
                <div class="space-y-2 rounded-lg border border-status-danger/20 bg-status-danger/5 p-4 shrink-0">
                    <div class="flex items-center gap-2 text-sm font-medium text-status-danger">
                        <AlertCircle class="size-4" />
                        Disabled for this server
                    </div>
                    <p class="text-sm text-terminal-foreground/80">
                        Reason: {enumLabel(ModLoaderSchema, server.modLoader)} {server.mcVersion} is not supported.
                        <a
                            href="https://docs.discopanel.app/command-completion/"
                            target="_blank"
                            rel="noopener noreferrer"
                            class="text-blue-400 hover:underline"
                        >
                            View supported Mod Loaders and Minecraft versions.
                        </a>
                    </p>
                </div>
            {:else}
                <div class="relative shrink-0">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-terminal-foreground/50" />
                    <Input
                        type="text"
                        placeholder="Search commands..."
                        bind:value={searchQuery}
                        class="pl-9"
                    />
                </div>

                <div class="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1 min-h-0 overflow-hidden">
                    <!-- Linke Spalte: Scrollbare Liste -->
                    <div class="md:col-span-5 border rounded-lg p-2 overflow-y-auto min-h-0 space-y-1">
                        {#if filteredCmds.length > 0}
                            {#each filteredCmds as baseCommand (baseCommand.name)}
                                <button
                                    type="button"
                                    onclick={() => selectedCommand = baseCommand}
                                    class="w-full text-left px-3 py-2 rounded-md font-mono text-sm transition flex items-center justify-between {selectedCommand?.name === baseCommand.name ? 'bg-terminal-foreground/15 border-terminal-foreground/20 border' : 'hover:bg-terminal-foreground/8'}"
                                >
                                    <span class="truncate">{baseCommand.name}</span>
                                    <ChevronRight class="size-4 text-terminal-foreground/40 shrink-0" />
                                </button>
                            {/each}
                        {:else}
                            <p class="text-sm text-terminal-foreground/50 p-3 text-center">No commands found.</p>
                        {/if}
                    </div>

                    <!-- Rechte Spalte: Command Infos -->
                    <div class="md:col-span-7 border rounded-lg p-4 flex flex-col justify-between bg-terminal-foreground/2 min-h-0 overflow-hidden">
                        {#if selectedCommand}
    					    <div class="space-y-4 overflow-y-auto flex-1 min-h-0 pr-1">
    					        <div class="flex items-center justify-between pb-3 border-b">
    					            <h3 class="font-mono font-bold text-xl text-terminal-foreground">
    					                {selectedCommand.name}
    					            </h3>
									{#if !selectedCommand.description}
										<div class="justify-end shrink-0">
    					    			    <Button
    					    			        href={selectedCommand.url || (commandDocsUrl ? commandDocsUrl : undefined)}
    					    			        target="_blank"
    					    			        rel="external noopener noreferrer"
    					    			        size="sm"
    					    			        disabled={!selectedCommand.url && !commandDocsUrl}
    					    			    >
    					    			        <ExternalLink class="size-4" />
    					    			        Open Documentation
    					    			    </Button>
    					    			</div>
									{/if}
    					        </div>
							
    					        {#if selectedCommand.description}
    					            <div>
    					                <p class="text-xs uppercase tracking-wide text-terminal-foreground/50 mb-1.5">Description</p>
    					                <p class="text-sm text-terminal-foreground/80 whitespace-pre-line leading-relaxed">
    					                    {selectedCommand.description}
    					                </p>
    					            </div>
    					        {/if}
    					    </div>
							{#if selectedCommand.description}
    					    	<div class="pt-3 mt-3 flex justify-end shrink-0 border-t">
    					    	    <Button
    					    	        href={selectedCommand.url || (commandDocsUrl ? commandDocsUrl : undefined)}
    					    	        target="_blank"
    					    	        rel="external noopener noreferrer"
    					    	        size="sm"
    					    	        disabled={!selectedCommand.url && !commandDocsUrl}
    					    	    >
    					    	        <ExternalLink class="size-4" />
    					    	        Open Documentation
    					    	    </Button>
    					    	</div>
							{/if}
    					{:else}
    					    <div class="h-full flex items-center justify-center text-terminal-foreground/40 text-sm">
    					        Select a command to view details
    					    </div>
    					{/if}
                    </div>
                </div>
            {/if}
        </div>

        <Dialog.Footer class="gap-2 pt-3 border-t shrink-0">
            <Button variant="outline" size="sm" onclick={() => (showCmdCInfo = false)}>
                Close
            </Button>
            <Button
                href={commandDocsUrl ? commandDocsUrl : undefined}
                target="_blank"
                rel="noopener noreferrer"
                size="sm"
                disabled={!commandDocsUrl}
            >
                <ExternalLink class="size-4" />
                View {enumLabel(ModLoaderSchema, server.modLoader)} Commands
            </Button>
        </Dialog.Footer>
    </Dialog.Content>
</Dialog.Root>

<style>
	.log-line {
		padding: 0.125rem 0;
		line-height: 1.45;
	}

	.log-line:hover {
		background-color: color-mix(in oklab, var(--terminal-foreground) 6%, transparent);
	}

	.log-line[data-type='command'] {
		color: var(--status-ok);
		font-weight: 500;
	}

	.log-line[data-type='command']::before {
		content: '❯ ';
		color: var(--status-ok);
		font-weight: bold;
	}

	.log-line[data-type='command_output'] {
		opacity: 0.9;
		padding-left: 1rem;
	}

	.log-line[data-type='warn'] {
		color: var(--status-warn);
	}

	.log-line[data-type='error'],
	.log-line[data-type='fatal'] {
		color: var(--status-danger);
	}

	.action-line {
		padding: 0.2rem 0.375rem;
		line-height: 1.45;
		border-radius: 0.25rem;
	}

	.action-line:hover {
		background-color: color-mix(in oklab, var(--terminal-foreground) 6%, transparent);
	}

	.action-highlight {
		background-color: rgba(139, 92, 246, 0.12);
		box-shadow: inset 2px 0 0 rgba(139, 92, 246, 0.7);
	}

	.action-detail {
		padding: 0.2rem 0.375rem 0.35rem;
		border-left: 1px solid color-mix(in oklab, var(--terminal-foreground) 15%, transparent);
		font-size: 11px;
		line-height: 1.4;
	}
</style>
