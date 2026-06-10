import type Completions from "./completions";

type CommandObject = {
	command: string;
	type: 'literal' | 'argument' | 'choice' | 'optional';
	aliasses: string[];
	subcommands: CommandObject[];
	isEndpoint: boolean;
};

const mappings: Record<string, string[]> = {
	'<gamemode>': ['adventure', 'survival', 'creative', 'spectator'],
	'<targets>': ['@a', '@e','@n', '@s', '@p', '@r'],
	'[<targets>]': ['@a', '@e','@n', '@s', '@p', '@r'],
	'<target>': ['@a', '@e', '@s', '@p', '@r']
};

export default class VanillaCompletions implements Completions {
	private commands: CommandObject[] = [];
	private commandFunction: (command: string) => Promise<string>;

	// Regex patterns for token type detection - compiled once at class level
	private readonly tokenPatterns = {
		argument: /^<[^>]+>$/, // <target>
		optional: /^\[[^\]]+\]$/, // [targets]
		choice: /^\([^)]+\)$/ // (option1|option2)
	};

	constructor(
		commandFunction: (command: string) => Promise<string>
	) {
		
		this.commandFunction = commandFunction;
	}

	public async getBaseCommands(): Promise<string[]> {
		if (this.commands.length === 0) this.commands = this.parseCommands(await this.commandFunction('help'));
		return Array.from(
			new Set(this.commands.flatMap((cmd) => [cmd.command, ...cmd.aliasses]))
		).sort((left, right) => left.localeCompare(right));
	}

	private parseCommands(raw: string): CommandObject[] {
		const COMMANDS: CommandObject[] = [];
		const aliases: Map<string, string> = new Map();

		const commands: string[] = raw.split('/').filter((cmd) => cmd.trim());

		for (let cmd of commands) {
			cmd = cmd.trim();

			// Handle aliases (e.g., "xp -> experience")
			const aliasMatch = cmd.match(/^(\w+)\s*->\s*(\w+)$/);
			if (aliasMatch) {
				aliases.set(aliasMatch[1], aliasMatch[2]);
				continue;
			}

			const tokens = this.tokenizeCommandLine(cmd);
			if (tokens.length === 0) continue;

			const baseToken = tokens[0];
			const commandObject: CommandObject = {
				command: baseToken,
				type: 'literal',
				subcommands: [],
				aliasses: [],
				isEndpoint: false
			};

			// Process remaining tokens
			this.appendParsedTokens(commandObject, tokens.slice(1));
			COMMANDS.push(commandObject);
		}

		// Apply aliases to commands
		aliases.forEach((targetCommand, aliasName) => {
			const commandObject = COMMANDS.find((x) => x.command === targetCommand);
			if (commandObject) {
				commandObject.aliasses.push(aliasName);
			}
		});

		return COMMANDS;
	}

	private tokenizeCommandLine(line: string): string[] {
		// Split by whitespace but preserve tokens with special delimiters
		const tokens: string[] = [];
		let current = '';
		let depth = 0; // Track nesting depth for brackets/parens

		for (let i = 0; i < line.length; i++) {
			const char = line[i];

			// Track nesting to handle tokens like (a|b|c) or [a|b]
			if (char === '(' || char === '[' || char === '<') depth++;
			if (char === ')' || char === ']' || char === '>') depth--;

			if (char === ' ' && depth === 0) {
				if (current) {
					tokens.push(current);
					current = '';
				}
			} else {
				current += char;
			}
		}

		if (current) {
			tokens.push(current);
		}

		return tokens.filter((t) => t.length > 0);
	}

	private getChilds(commandObject: CommandObject): CommandObject[] {
		// Wenn dieser Knoten keine Subcommands hat, ist er ein Blatt
		if (commandObject.subcommands.length === 0) {
			return [commandObject];
		}

		// Ansonsten rekursiv in alle Subcommands gehen und Blätter sammeln
		const childs: CommandObject[] = [];
		commandObject.subcommands.forEach((element) => {
			childs.push(...this.getChilds(element));
		});
		return childs;
	}

	private tokenizeCommand(command: string): string[] {
		const trimmed = command.trim();
		return trimmed === '' ? [] : trimmed.split(/\s+/);
	}

	private getTokenType(token: string): CommandObject['type'] {
		// Use class-level regex patterns for efficiency
		if (this.tokenPatterns.argument.test(token)) return 'argument';
		if (this.tokenPatterns.optional.test(token)) return 'optional';
		if (this.tokenPatterns.choice.test(token)) return 'choice';
		return 'literal';
	}

	private isDecoratedToken(token: string): boolean {
		return /^[<[(]/.test(token);
	}

	private createCommandObject(token: string): CommandObject {
		// Use class-level regex patterns for efficiency
		let commandType: CommandObject['type'] = 'literal';
		let command = token;

		if (this.tokenPatterns.argument.test(token)) {
			commandType = 'argument';
		} else if (this.tokenPatterns.optional.test(token)) {
			commandType = 'optional';
		} else if (this.tokenPatterns.choice.test(token)) {
			commandType = 'choice';
			command = token.slice(1, -1); // Remove outer parens
		}

		return {
			command,
			type: commandType,
			subcommands: [],
			aliasses: [],
			isEndpoint: false
		};
	}

	private appendParsedTokens(commandObject: CommandObject, tokens: string[]): void {
		for (const token of tokens) {
			if (token === '') continue;

			const childs = this.getChilds(commandObject);

			if (this.tokenPatterns.argument.test(token)) {
				childs.forEach((element) => {
					element.subcommands.push(this.createCommandObject(token));
				});
			} else if (this.tokenPatterns.optional.test(token)) {
				// If the optional token contains choices like [a|b], split into literals
				const inner = token.slice(1, -1);
				if (inner.includes('|')) {
					const choices = inner.split('|').map((c) => c.trim());
					choices.forEach((choice) => {
						childs.forEach((element) => {
							const obj = this.createCommandObject(choice);
							obj.type = 'optional';
							element.subcommands.push(obj);
						});
					});
				} else {
					childs.forEach((element) => {
						element.subcommands.push(this.createCommandObject(token));
					});
				}
			} else if (this.tokenPatterns.choice.test(token)) {
				// Extract choices from (option1|option2|...)
				const choicesStr = token.slice(1, -1);
				const choices = choicesStr.split('|').map((c) => c.trim());
				choices.forEach((choice) => {
					childs.forEach((element) => {
						element.subcommands.push(this.createCommandObject(choice));
					});
				});
			} else {
				childs.forEach((element) => {
					element.subcommands.push(this.createCommandObject(token));
				});
			}
		}
	}

	private mergeCommandSubtrees(target: CommandObject, sources: CommandObject[]): void {
		for (const source of sources) {
			const existing = target.subcommands.find(
				(child) => child.command === source.command && child.type === source.type
			);

			if (!existing) {
				target.subcommands.push(source);
				continue;
			}

			if (source.subcommands.length > 0) {
				this.mergeCommandSubtrees(existing, source.subcommands);
			}
		}
	}

	private stripCommandDecorators(command: string): string {
		// Remove only the decorator characters but keep choice separators like '|'
		// e.g. '(grant|revoke)' -> 'grant|revoke'
		return command.replace(/[<>[]()]/g, '').trim();
	}

	private normalizeComparisonToken(token: string): string {
		return this.stripCommandDecorators(token).replace(/^\/+/, '');
	}

	private buildHelpCommand(currentCommand: string, appendTrailingSpace = false): string {
		const rawTokens = this.tokenizeCommand(currentCommand);
		const normalizedTokens = rawTokens
			.map((token) => this.stripCommandDecorators(token))
			.filter((token) => token !== '');

		const cmd = `help ${normalizedTokens.join(' ')}`.trim();
		return appendTrailingSpace ? `${cmd} ` : cmd;
	}

	private findNextSubcommand(
		commandObject: CommandObject,
		token: string
	): CommandObject | undefined {
		const exactMatch = commandObject.subcommands.find(
			(subcommand) => subcommand.command === token || subcommand.aliasses.includes(token)
		);

		if (exactMatch) {
			return exactMatch;
		}

		const argumentMatch = commandObject.subcommands.find(
			(subcommand) => subcommand.type === 'argument'
		);
		if (argumentMatch) {
			return argumentMatch;
		}

		return commandObject.subcommands.find((subcommand) => subcommand.type === 'optional');
	}

	private collectExistingParameterNames(commandObject: CommandObject, names: Set<string>): void {
		for (const subcommand of commandObject.subcommands) {
			// Only consider argument or optional tokens as parameter names
			if (subcommand.type === 'argument' || subcommand.type === 'optional') {
				const cleaned = this.stripCommandDecorators(subcommand.command);
				if (cleaned !== '') {
					names.add(cleaned);
				}
			}

			this.collectExistingParameterNames(subcommand, names);
		}
	}

	private shouldIgnoreRepeatedOptionalTail(
		commandObject: CommandObject,
		tailTokens: string[],
		rootCommand?: string,
		currentCommand?: string
	): boolean {
		if (tailTokens.length === 0) {
			return false;
		}

		// If there are no consumed tokens beyond the root, do not treat base-level optionals as repeated.
		const consumedCount = this.tokenizeCommand(currentCommand ?? '').length - 1;
		if (consumedCount <= 0) {
			return false;
		}

		const currentCommandRawTokens = this.tokenizeCommand(currentCommand ?? '');

		// Build reverse map from concrete values to parameter names, e.g. 'survival' -> 'gamemode'
		const reverseMap = new Map<string, string>();
		for (const key of Object.keys(mappings)) {
			const nameKey = this.stripCommandDecorators(key);
			for (const v of mappings[key] ?? []) {
				reverseMap.set(v, nameKey);
			}
		}

		// Build set of existing parameter names from the root command, if available
		const existingParamNames = new Set<string>();
		if (rootCommand) {
			const rootCmdObject = this.commands.find((cmd) => cmd.command === rootCommand);
			if (rootCmdObject) {
				this.collectExistingParameterNames(rootCmdObject, existingParamNames);
			}
		}

		// Consider a repeated tail token a cycle only if the repeated name is a known
		// parameter name for the root command and it already appears in the consumed tokens.
		const repeatedTailToken = tailTokens
			.map((token) => this.stripCommandDecorators(token))
			.find((name) => {
				if (name === '') return false;
				if (!existingParamNames.has(name)) return false;
				return currentCommandRawTokens.slice(1).some((ct) => {
					const ctClean = this.stripCommandDecorators(ct);
					return ctClean === name || reverseMap.get(ct) === name || reverseMap.get(ctClean) === name;
				});
			});

		if (repeatedTailToken) {
			return true;
		}

		if (!tailTokens.every((token) => this.getTokenType(token) === 'optional')) {
			return false;
		}

		const tailParamNames = tailTokens
			.map((token) => this.stripCommandDecorators(token))
			.filter((name) => name !== '');

		if (tailParamNames.length === 0) {
			return false;
		}



		if (currentCommand) {
			const consumedTokens = this.tokenizeCommand(currentCommand).slice(1);
			for (const token of consumedTokens) {
				const cleaned = this.stripCommandDecorators(token);
				if (cleaned !== '') {
					existingParamNames.add(cleaned);
				}
				const mapped = reverseMap.get(token) ?? reverseMap.get(cleaned);
				if (mapped) {
					existingParamNames.add(mapped);
				}
			}
		}
		// Also collect from current object
		this.collectExistingParameterNames(commandObject, existingParamNames);

		return tailParamNames.every((name) => existingParamNames.has(name));
	}

	private async mergeHelpOutput(
		commandObject: CommandObject,
		currentCommand: string,
		appendTrailingSpace = false
	): Promise<void> {
		if (commandObject.isEndpoint) {
			return;
		}

		const commandTokens = this.tokenizeCommand(currentCommand);
		let helpOutput = '';
		let command = '';

		for (let endIndex = commandTokens.length; endIndex > 0; endIndex--) {
			const candidateCommand = commandTokens.slice(0, endIndex).join(' ');
			const shouldAppendTrailingSpace = endIndex === commandTokens.length && appendTrailingSpace;
			command = this.buildHelpCommand(candidateCommand, shouldAppendTrailingSpace);
			helpOutput = (await this.commandFunction(command)).trim();

			// If we probed the most specific command (full currentCommand) and
			// it returned empty (even after trying without trailing space), then
			// treat this node as an endpoint and do not fall back to broader help.
			if (endIndex === commandTokens.length && helpOutput === '') {
				if (shouldAppendTrailingSpace) {
					const trimmedCommand = this.buildHelpCommand(candidateCommand, false);
					if (trimmedCommand !== command) {
						helpOutput = (await this.commandFunction(trimmedCommand)).trim();
					}
				}
				if (helpOutput === '') {
					commandObject.isEndpoint = true;
					return;
				}
			}
			if (helpOutput === '' && shouldAppendTrailingSpace) {
				const trimmedCommand = this.buildHelpCommand(candidateCommand, false);
				if (trimmedCommand !== command) {
					helpOutput = (await this.commandFunction(trimmedCommand)).trim();
				}
			}

			if (helpOutput !== '') {
				break;
			}
		}
		// Debug: expose what help command was requested and what returned
		// (kept minimal to avoid excessive noise in other contexts)
		try {
			// eslint-disable-next-line no-console
			console.debug(`[Completions] help-> ${command} => ${helpOutput}`);
		} catch ( _ ) {
			/* ignore */
		}

		if (helpOutput.trim() === '') {
			commandObject.isEndpoint = true;
			return;
		}

		const inputTokens = this.tokenizeCommand(currentCommand);
		const helpSegments = helpOutput
			.split('/')
			.map((segment) => segment.trim())
			.filter((segment) => segment !== '');
		const rootCommand = currentCommand.split(/\s+/)[0];
		let appendedAny = false;

		for (const helpSegment of helpSegments) {
			const outputTokens = this.tokenizeCommand(helpSegment);
			const normalizedInputTokens = inputTokens
				.map((token) => this.normalizeComparisonToken(token))
				.filter((token) => token !== '');
			const normalizedOutputTokens = outputTokens
				.map((token) => this.normalizeComparisonToken(token))
				.filter((token) => token !== '');

			let matchedPrefixLength = 0;
			while (
				matchedPrefixLength < normalizedInputTokens.length &&
				matchedPrefixLength < normalizedOutputTokens.length &&
				normalizedInputTokens[matchedPrefixLength] === normalizedOutputTokens[matchedPrefixLength]
			) {
				matchedPrefixLength += 1;
			}

			if (matchedPrefixLength >= outputTokens.length) {
				continue;
			}

			const tailTokens = outputTokens.slice(matchedPrefixLength);

			if (tailTokens.length > 0 && this.isDecoratedToken(tailTokens[0])) {
				const tailType = this.getTokenType(tailTokens[0]);
				// Only probe for arguments and choices; avoid probing optionals like [ips|players]
				if (tailType === 'argument' || tailType === 'choice') {
					const tailProbeCommand = this.buildHelpCommand(
						`${currentCommand} ${tailTokens[0]}`,
						true
					);
					await this.commandFunction(tailProbeCommand);
				}
			}

			if (
				this.shouldIgnoreRepeatedOptionalTail(
					commandObject,
					tailTokens,
					rootCommand,
					currentCommand
				)
			) {
				commandObject.isEndpoint = true;
				return;
			}

			const segmentRoot: CommandObject = {
				command: commandObject.command,
				type: commandObject.type,
				aliasses: [],
				subcommands: [],
				isEndpoint: false
			};
			this.appendParsedTokens(segmentRoot, tailTokens);
			this.mergeCommandSubtrees(commandObject, segmentRoot.subcommands);
			appendedAny = true;
		}

		if (!appendedAny) {
			commandObject.isEndpoint = true;
		}
	}

	private extractOnlinePlayers(listOutput: string): string[] {
		const separatorIndex = listOutput.indexOf(':');
		if (separatorIndex === -1) {
			return [];
		}

		const playersPart = listOutput.slice(separatorIndex + 1);
		return playersPart
			.split(',')
			.map((name) => name.trim())
			.filter((name) => name !== '');
	}

	private isTargetPlaceholderToken(token: string): boolean {
		const normalized = this.stripCommandDecorators(token).toLowerCase();
		return normalized === 'target' || normalized === 'targets';
	}

	private async collectChildCompletions(
		commandObject: CommandObject,
		currentToken: string
	): Promise<string[]> {
		const output: string[] = [];
		const isParameterToken = /^[<[(]/.test(currentToken);
		let hasTargetPlaceholder = false;

		// Build reverse map for mappings: concrete value -> placeholder name
		const reverseMap = new Map<string, string>();
		for (const key of Object.keys(mappings)) {
			const nameKey = this.stripCommandDecorators(key);
			for (const v of mappings[key] ?? []) {
				reverseMap.set(v, nameKey);
			}
		}

		for (const element of commandObject.subcommands) {
			// Check if command matches
			if (element.command.startsWith(currentToken)) {
				output.push(element.command);
				if (this.isTargetPlaceholderToken(element.command)) {
					hasTargetPlaceholder = true;
				}
				continue;
			}

			// Check if any alias matches
			const matchingAlias = element.aliasses.find((alias) => alias.startsWith(currentToken));
			if (matchingAlias) {
				output.push(matchingAlias);
				continue;
			}

			// Include argument and optional tokens for completion, but filter by prefix
				// Include argument and optional tokens for completion.
				// If the user has already typed a concrete value (e.g. '@s' or a name),
				// still suggest the placeholder token so users can see the parameter name.
				if ((element.type === 'argument' || element.type === 'optional') && !isParameterToken) {
					// Show placeholders when:
					// - no current token (user pressed space),
					// - the placeholder matches the current prefix,
					// - or the user entered a concrete value (selector or a mapped real value).
					const isConcreteValue = currentToken.startsWith('@') || reverseMap.has(currentToken);
					if (currentToken === '' || element.command.startsWith(currentToken) || isConcreteValue) {
						output.push(element.command);
						if (this.isTargetPlaceholderToken(element.command)) {
							hasTargetPlaceholder = true;
						}
					}
				}
		}

		// Resolve player names dynamically each time target placeholders are available.
		if (hasTargetPlaceholder) {
			const listOutput = await this.commandFunction('list');
			const players = this.extractOnlinePlayers(listOutput).filter(
				(name) => currentToken === '' || name.startsWith(currentToken)
			);
			output.push(...players);
		}

		return Array.from(new Set(output));
	}

	private isMappedKey(value: string): boolean {
		return Object.prototype.hasOwnProperty.call(mappings, value);
	}

	private expandCompletions(completions: string[], currentToken: string): string[] {
		const expanded = completions.flatMap((completion) => {
			const mappedValues = mappings[completion] ?? [];
			const filteredMappedValues = mappedValues.filter(
				(value) => currentToken === '' || value.startsWith(currentToken)
			);

			if (!this.isMappedKey(completion)) {
				return [completion, ...filteredMappedValues];
			}

			return [...filteredMappedValues, completion];
		});

		const uniqueCompletions = Array.from(new Set(expanded));
		return uniqueCompletions.sort((left, right) => {
			const leftIsKey = this.isMappedKey(left);
			const rightIsKey = this.isMappedKey(right);

			if (leftIsKey && !rightIsKey) return 1;
			if (!leftIsKey && rightIsKey) return -1;
			return left.localeCompare(right);
		});
	}

	private findMatchingCommands(commands: CommandObject[], prefix: string): string[] {
		const matches: string[] = [];

		for (const cmd of commands) {
			if (cmd.command.startsWith(prefix)) {
				matches.push(cmd.command);
			}

			const matchingAliases = cmd.aliasses.filter((alias) => alias.startsWith(prefix));
			matches.push(...matchingAliases);
		}

		return matches;
	}

	public async getPossibleCompletions(input: string): Promise<string[]> {
		if (this.commands.length === 0) this.commands = this.parseCommands(await this.commandFunction('help'));
		const endsOnSpace: boolean = /\s$/.test(input);
		const trimmedInput = input.trim();
		const tokens: string[] = trimmedInput === '' ? [] : trimmedInput.split(/\s+/);
		if (endsOnSpace && tokens.length > 0) {
			tokens.push('');
		}

		const firstToken: string = tokens[0] ?? '';
		const helpPrefix = firstToken === 'help' && tokens.length > 1;

		// No input - return all commands
		if (tokens.length === 0) {
			const allCommands = this.commands.flatMap((cmd) => [cmd.command, ...cmd.aliasses]);
			return this.expandCompletions(allCommands, '');
		}

		// Single token - return matching commands
		if (tokens.length === 1 && !endsOnSpace) {
			const matches = this.findMatchingCommands(this.commands, firstToken);
			return this.expandCompletions(matches, firstToken);
		}

		// Find the base command
		const baseCommand: CommandObject | undefined = this.commands.find(
			(x) => x.command === firstToken || x.aliasses.includes(firstToken)
		);

		if (!baseCommand && helpPrefix) {
			const helpCommandToken = tokens[1];
			const helpBaseCommand = this.commands.find(
				(x) => x.command === helpCommandToken || x.aliasses.includes(helpCommandToken)
			);

			if (helpBaseCommand) {
				// Replace concrete mapped values with their placeholder names (e.g. 'survival' -> 'gamemode')
				const reverseMap = new Map<string, string>();
				for (const key of Object.keys(mappings)) {
					const nameKey = this.stripCommandDecorators(key);
					for (const v of mappings[key] ?? []) {
						reverseMap.set(v, nameKey);
					}
				}

				const probeTokens = tokens.slice(1).map((t) => {
					const mapped = reverseMap.get(t) ?? reverseMap.get(this.stripCommandDecorators(t));
					return mapped ?? t;
				});

				// Fetch the explicit help output for the full help query to detect
				// repeated optional tails (generic cycle detection) before recursing.
				const fullHelpCmd = this.buildHelpCommand(probeTokens.join(' '), true);
				let helpOut = (await this.commandFunction(fullHelpCmd)).trim();
				if (helpOut === '') {
					const trimmedFull = this.buildHelpCommand(tokens.slice(1).join(' '), false);
					if (trimmedFull !== fullHelpCmd) {
						helpOut = (await this.commandFunction(trimmedFull)).trim();
					}
				}
				// If explicit help returned empty, treat as endpoint (no completions)
				if (helpOut.trim() === '') {
					return [];
				}
				if (helpOut !== '') {
					const outputTokens = this.tokenizeCommand(helpOut);
					// compute matched prefix length against the provided tokens after 'help'
					const providedTokens = tokens.slice(1).map((t) => this.normalizeComparisonToken(t)).filter((t) => t !== '');
					const normalizedOutputTokens = outputTokens.map((t) => this.normalizeComparisonToken(t)).filter((t) => t !== '');
					let matchLen = 0;
					while (matchLen < providedTokens.length && matchLen < normalizedOutputTokens.length && providedTokens[matchLen] === normalizedOutputTokens[matchLen]) {
						matchLen += 1;
					}
					const tailTokens = outputTokens.slice(matchLen);
					if (this.shouldIgnoreRepeatedOptionalTail(helpBaseCommand, tailTokens, helpCommandToken, tokens.slice(1).join(' '))) {
						return [];
					}
				}
				return this.expandCompletions(
					await this.rekursiveSearch(helpBaseCommand, tokens.slice(2), [helpCommandToken]),
					(tokens.length > 0 ? tokens[tokens.length - 1] : '')
				);
			}
		}

		if (!baseCommand) return [];

		// Recursively search for completions
		return this.expandCompletions(
			await this.rekursiveSearch(baseCommand, tokens.slice(1), [firstToken]),
			(tokens.length > 0 ? tokens[tokens.length - 1] : '')
		);
	}

	private async rekursiveSearch(
		commandObject: CommandObject,
		tokens: string[],
		consumedTokens: string[]
	): Promise<string[]> {
		const firstToken: string = tokens[0] ?? '';
		const currentTokens = firstToken && !this.isDecoratedToken(firstToken)
			? [...consumedTokens, firstToken]
			: consumedTokens;
		const currentCommand = currentTokens.join(' ');

		if (firstToken && this.isDecoratedToken(firstToken)) {
			const probeCommand = this.buildHelpCommand(`${currentCommand} ${firstToken}`, true);
			await this.commandFunction(probeCommand);
		}

		// Fetch help output if we haven't already
		if (commandObject.subcommands.length === 0 && !commandObject.isEndpoint) {
			await this.mergeHelpOutput(commandObject, currentCommand, firstToken === '');
		}

		// Last token - return possible completions for this token
		if (tokens.length === 1) {
			// Build reverse map for mappings: concrete value -> placeholder name
			const reverseMap = new Map<string, string>();
			for (const key of Object.keys(mappings)) {
				const nameKey = this.stripCommandDecorators(key);
				for (const v of mappings[key] ?? []) {
					reverseMap.set(v, nameKey);
				}
			}

			// If the user provided a concrete value that corresponds to an
			// `argument`/`optional` parameter on this node, probe the full
			// help for the consumed path; if it returns empty, treat as endpoint.
			for (const sub of commandObject.subcommands) {
				if (sub.type !== 'argument' && sub.type !== 'optional') continue;
				const subName = this.stripCommandDecorators(sub.command);
				const tokenClean = this.stripCommandDecorators(firstToken);
				const mapped = reverseMap.get(firstToken) ?? reverseMap.get(tokenClean);
				if (tokenClean === subName || mapped === subName) {
					if (sub.type === 'optional') {
						const probe = this.buildHelpCommand(`${currentCommand}`, true);
						await this.commandFunction(probe);
						return [];
					}
					const probe = this.buildHelpCommand(`${currentCommand}`, true);
					let helpOut = (await this.commandFunction(probe)).trim();
					// DEBUG
					try {
						// eslint-disable-next-line no-console
						console.debug(`[Completions DEBUG] probe -> ${probe} => '${helpOut}'`);
					} catch ( _ ) {
						/* ignore */
					}
					if (helpOut === '') {
						const trimmedProbe = this.buildHelpCommand(`${currentCommand}`, false);
						if (trimmedProbe !== probe) {
							helpOut = (await this.commandFunction(trimmedProbe)).trim();
							// DEBUG
							try {
								// eslint-disable-next-line no-console
								console.debug(`[Completions DEBUG] probe -> ${trimmedProbe} => '${helpOut}'`);
							} catch ( _ ) {
								/* ignore */
							}
						}
					}
					if (helpOut === '') return [];
					break;
				}
			}

			return await this.collectChildCompletions(commandObject, firstToken);
		}

		// Find the next command or argument
		const next = this.findNextSubcommand(commandObject, firstToken);

		if (next) {
			const nextConsumedTokens = this.isDecoratedToken(firstToken)
				? [...currentTokens, this.stripCommandDecorators(firstToken)]
				: currentTokens;
			return this.rekursiveSearch(next, tokens.slice(1), nextConsumedTokens);
		}

		// If not found and not an endpoint, try fetching more help
		if (!commandObject.isEndpoint) {
			await this.mergeHelpOutput(commandObject, currentCommand, firstToken === '');

			// Try again after fetching help
			const retryNext = this.findNextSubcommand(commandObject, firstToken);

			if (retryNext) {
				const retryConsumedTokens = this.isDecoratedToken(firstToken)
					? [...currentTokens, this.stripCommandDecorators(firstToken)]
					: currentTokens;
				return this.rekursiveSearch(retryNext, tokens.slice(1), retryConsumedTokens);
			}
		}

		return [];
	}
}
