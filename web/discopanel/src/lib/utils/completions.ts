type CommandObject = {
	command: string;
	type: 'literal' | 'argument' | 'choice' | 'optional';
	aliasses: string[];
	subcommands: CommandObject[];
	isEndpoint: boolean;
};

class Completions {
	private commands: CommandObject[] = [];
	private mappings: Record<string, string[]>;
	private commandFunction: (command: string) => Promise<string>;

	// Regex patterns for token type detection - compiled once at class level
	private readonly tokenPatterns = {
		argument: /^<[^>]+>$/, // <target>
		optional: /^\[[^\]]+\]$/, // [targets]
		choice: /^\([^)]+\)$/ // (option1|option2)
	};

	constructor(
		baseHelpString: string,
		mappings: Record<string, string[]>,
		commandFunction: (command: string) => Promise<string>
	) {
		this.commands = this.parseCommands(baseHelpString);
		this.mappings = mappings;
		this.commandFunction = commandFunction;
	}

	private parseCommands(raw: string): CommandObject[] {
		let COMMANDS: CommandObject[] = [];
		let aliases: Map<string, string> = new Map();

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
		let childs: CommandObject[] = [];
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
				childs.forEach((element) => {
					element.subcommands.push(this.createCommandObject(token));
				});
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

	private stripCommandDecorators(command: string): string {
		// Remove all special characters: <>, [], (), | in one pass using regex
		return command.replace(/[<>\[\]()|\s]+/g, ' ').trim();
	}

	private buildHelpCommand(currentCommand: string): string {
		const rawTokens = this.tokenizeCommand(currentCommand);
		const normalizedTokens = rawTokens
			.map((token) => this.stripCommandDecorators(token))
			.filter((token) => token !== '');

		return `help ${normalizedTokens.join(' ')}`.trim();
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
			const cleaned = this.stripCommandDecorators(subcommand.command);
			if (cleaned !== '') {
				names.add(cleaned);
			}

			this.collectExistingParameterNames(subcommand, names);
		}
	}

	private shouldIgnoreRepeatedOptionalTail(
		commandObject: CommandObject,
		tailTokens: string[],
		rootCommand?: string
	): boolean {
		if (tailTokens.length === 0) {
			return false;
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

		const existingParamNames = new Set<string>();
		// If we have a root command, collect from the entire tree starting from that command
		if (rootCommand) {
			const rootCmdObject = this.commands.find((cmd) => cmd.command === rootCommand);
			if (rootCmdObject) {
				this.collectExistingParameterNames(rootCmdObject, existingParamNames);
			}
		}
		// Also collect from current object
		this.collectExistingParameterNames(commandObject, existingParamNames);

		return tailParamNames.every((name) => existingParamNames.has(name));
	}

	private async mergeHelpOutput(
		commandObject: CommandObject,
		currentCommand: string
	): Promise<void> {
		if (commandObject.isEndpoint) {
			return;
		}

		// Apply placeholder mappings only for help command execution.
		const command = this.buildHelpCommand(currentCommand);
		const helpOutput = (await this.commandFunction(command)).trim();

		if (helpOutput.trim() === '') {
			commandObject.isEndpoint = true;
			return;
		}

		const inputTokens = this.tokenizeCommand(currentCommand);
		const outputTokens = this.tokenizeCommand(helpOutput);

		if (outputTokens.length <= inputTokens.length) {
			return;
		}

		const tailTokens = outputTokens.slice(inputTokens.length);

		// Extract root command from currentCommand (first token)
		const rootCommand = currentCommand.split(/\s+/)[0];

		if (this.shouldIgnoreRepeatedOptionalTail(commandObject, tailTokens, rootCommand)) {
			commandObject.isEndpoint = true;
			return;
		}

		this.appendParsedTokens(commandObject, tailTokens);
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
		const isParameterToken = /^[<\[\(]/.test(currentToken);
		let hasTargetPlaceholder = false;

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

			// Always include argument and optional tokens for completion
			if ((element.type === 'argument' || element.type === 'optional') && !isParameterToken) {
				output.push(element.command);
				if (this.isTargetPlaceholderToken(element.command)) {
					hasTargetPlaceholder = true;
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
		return Object.prototype.hasOwnProperty.call(this.mappings, value);
	}

	private expandCompletions(completions: string[], currentToken: string): string[] {
		const expanded = completions.flatMap((completion) => {
			const mappedValues = this.mappings[completion] ?? [];
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
		const endsOnSpace: boolean = /\s$/.test(input);
		const trimmedInput = input.trim();
		const tokens: string[] = trimmedInput === '' ? [] : trimmedInput.split(/\s+/);
		if (endsOnSpace && tokens.length > 0) {
			tokens.push('');
		}

		const firstToken: string = tokens[0] ?? '';

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

		if (!baseCommand) return [];

		// Recursively search for completions
		return this.expandCompletions(
			await this.rekursiveSearch(baseCommand, tokens.slice(1), firstToken),
			tokens.at(-1) ?? ''
		);
	}

	private async rekursiveSearch(
		commandObject: CommandObject,
		tokens: string[],
		commandPath: string
	): Promise<string[]> {
		const firstToken: string = tokens[0] ?? '';
		const currentCommand = firstToken ? `${commandPath} ${firstToken}` : commandPath;

		// Fetch help output if we haven't already
		if (commandObject.subcommands.length === 0 && !commandObject.isEndpoint) {
			await this.mergeHelpOutput(commandObject, currentCommand);
		}

		// Last token - return possible completions for this token
		if (tokens.length === 1) {
			return await this.collectChildCompletions(commandObject, firstToken);
		}

		// Find the next command or argument
		const next = this.findNextSubcommand(commandObject, firstToken);

		if (next) {
			return this.rekursiveSearch(next, tokens.slice(1), currentCommand);
		}

		// If not found and not an endpoint, try fetching more help
		if (!commandObject.isEndpoint) {
			await this.mergeHelpOutput(commandObject, commandPath);

			// Try again after fetching help
			const retryNext = this.findNextSubcommand(commandObject, firstToken);

			if (retryNext) {
				return this.rekursiveSearch(retryNext, tokens.slice(1), currentCommand);
			}
		}

		return [];
	}
}

export default Completions;
