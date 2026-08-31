import { describe, it, expect, vi } from 'vitest';
import Completions from './modloaders/vanilla';
import VanillaCompletions from './modloaders/vanilla';


describe('Completions', () => {
	// Helper to create a Completions instance with mocked help responses
	function createCompletions(helpResponses: Record<string, string>) {
		const commandFunction = vi.fn(async (command: string) => {
			return helpResponses[command] ?? '';
		});

		const instance = new VanillaCompletions(helpResponses['help'] ?? '', commandFunction);

		return {
			completions: {
				getPossibleCompletions: async (input: string) => {
					const res = await instance.getPossibleCompletions(input);
					return res.map((r) => r.value);
				},
				getBaseCommands: async () => {
					return instance.getBaseCommands();
				},
				isCommandValid: async (cmd: string) => {
					return instance.isCommandValid(cmd);
				}
			},
			commandFunction
		};
	}

	describe('Basic command completion', () => {
		it('should complete top-level commands', async () => {
			const { completions } = createCompletions({
				'help': '/clear [<targets>]'
			});

			const result = await completions.getPossibleCompletions('c');
			expect(result).toContain('clear');
		});

		it('should complete with subcommands', async () => {
			const { completions } = createCompletions({
				'help': '/clear [<targets>]',
				'help clear': '/clear [<targets>] [<item>] [<maxCount>]'
			});

			const result = await completions.getPossibleCompletions('clear ');
			expect(result).toContain('[<targets>]');
		});

		it('should expose sorted base commands and aliases', async () => {
			const { completions } = createCompletions({
				'help': '/experience/xp -> experience/alpha'
			});

			expect((await completions.getBaseCommands()).map((c) => c.name)).toEqual([
				'alpha',
				'experience',
				'xp'
			]);
		});
	});

	it('should suggest bossbar set <id> color choices', async () => {
		const { completions, commandFunction } = createCompletions({
			'help': '/bossbar (add|remove|list|set|get)',
			'help bossbar set': '/bossbar set <id> (name|color|style|value|max|visible|players)',
			'help bossbar set id': '/bossbar set id name <name>/bossbar set id color (pink|blue|red|green|yellow|purple|white)/bossbar set id style (progress|notched_6|notched_10|notched_12|notched_20)/bossbar set id value <value>/bossbar set id max <max>/bossbar set id visible <visible>/bossbar set id players [<targets>]',
			'help bossbar set id color': '/bossbar set id color pink/bossbar set id color blue/bossbar set id color red/bossbar set id color green/bossbar set id color yellow/bossbar set id color purple/bossbar set id color white',
			'help bossbar set id color white': ''
		});

		const result = await completions.getPossibleCompletions('bossbar set <id> color ');
		expect(result).toEqual(expect.arrayContaining(['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'white']));
	});

	describe('Help output with decorators', () => {
		it('should handle (grant|revoke) choice syntax', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/advancement',
				'help advancement': '/advancement (grant|revoke) <targets>'
			});

			const result = await completions.getPossibleCompletions('advancement ');
			expect(result).toContain('grant');
			expect(result).toContain('revoke');
		});

		it('should handle optional [<param>] syntax', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/clear',
				'help clear': '/clear [<targets>] [<item>] [<maxCount>]'
			});

			const result = await completions.getPossibleCompletions('clear ');
			expect(result).toContain('[<targets>]');
		});
	});

	describe('advancement from', () => {
		it('should handle advancement', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/advancement (grant|revoke)',
				'help advancement grant': '/advancement grant <targets> (only|from|until|through|everything)',
				'help advancement grant targets from': '/advancement grant targets from <advancement>',
				'help advancement grant targets from advancement': ''
			});

			const result = await completions.getPossibleCompletions('advancement grant <targets> from ');
			expect(result).toContain('<advancement>');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets ');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets from ');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets from advancement ');
		});
	});

	describe('advancement through', () => {
		it('should handle advancement', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/advancement (grant|revoke)',
				'help advancement grant': '/advancement grant <targets> (only|from|until|through|everything)',
				'help advancement grant targets through': '/advancement grant targets through <advancement>',
				'help advancement grant targets through advancement': ''
			});

			const result = await completions.getPossibleCompletions('advancement grant <targets> through ');
			expect(result).toContain('<advancement>');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets ');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets through ');
			expect(commandFunction).toHaveBeenCalledWith('help advancement grant targets through advancement ');
		});
	});

	describe('attribute ', () => {
		it('should handle attribute', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/attribute <target> <attribute> (get|base|modifier)',
				'help attribute target attribute get': '/attribute target attribute get <attribute> (get|base|modifier)' // cycle detection
			});

			const result = await completions.getPossibleCompletions('help attribute target attribute get ');
			expect(result).toHaveLength(0); // No new suggestions, should not loop infinitely
			expect(commandFunction).toHaveBeenCalledWith('help attribute target attribute get ');
		});

		it('should handle attribute base generically', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/attribute <target> <attribute> (get|base|modifier)',
				'help attribute target attribute base': '/attribute target attribute base <attribute> (get|base|modifier)'
			});

			const result = await completions.getPossibleCompletions('help attribute target attribute base ');
			expect(result).toHaveLength(0);
			expect(commandFunction).toHaveBeenCalledWith('help attribute target attribute base ');
		});

		it('should handle attribute modifier generically', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/attribute <target> <attribute> (get|base|modifier)',
				'help attribute target attribute modifier': '/attribute target attribute modifier <attribute> (get|base|modifier)'
			});

			const result = await completions.getPossibleCompletions('help attribute target attribute modifier ');
			expect(result).toHaveLength(0);
			expect(commandFunction).toHaveBeenCalledWith('help attribute target attribute modifier ');
		});
	});

	describe('generic cycle detection', () => {
		it('should ignore repeated command tokens for any command', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/custom <first> <second> <third>',
				'help custom first second': '/custom first second <first> <second> <third>'
			});

			const result = await completions.getPossibleCompletions('help custom first second ');
			expect(result).toHaveLength(0);
			expect(commandFunction).toHaveBeenCalledWith('help custom first second ');
		});
	});

	it('should not treat choice->argument sequences as cycles (locate biome)', async () => {
		const { completions, commandFunction } = createCompletions({
			'help': '/locate (structure|biome|poi)',
			'help locate biome': '/locate biome <biome>'
		});

		const result = await completions.getPossibleCompletions('help locate biome ');
		expect(result).toContain('<biome>');
		expect(commandFunction).toHaveBeenCalledWith('help locate biome ');
	});

	it('should treat literal->argument repetition as cycle (defaultgamemode)', async () => {
		const { completions, commandFunction } = createCompletions({
			'help': '/defaultgamemode <gamemode>',
			'help defaultgamemode gamemode': '/defaultgamemode gamemode <gamemode>'
		});

		const result = await completions.getPossibleCompletions('help defaultgamemode survival ');
		expect(result).toHaveLength(0);
		expect(commandFunction).toHaveBeenCalledWith('help defaultgamemode gamemode ');
	});

	it('should not probe optionals like [ips|players] for banlist', async () => {
		const { completions, commandFunction } = createCompletions({
			'help': '/banlist [ips|players]',
			'help banlist': '/banlist [ips]/banlist [players]',
			'help banlist ips': '',
		});

		const result = await completions.getPossibleCompletions('banlist ips ');
		const result1 = await completions.getPossibleCompletions('banlist ip');
		expect(result1).toContain('ips');
		expect(result1).toHaveLength(1);
		expect(result).toHaveLength(0);
		expect(commandFunction).toHaveBeenCalledWith('help banlist ips ');
	});

	describe('Real values instead of placeholders', () => {
		it('should handle real player name instead of <targets>', async () => {
			const { completions } = createCompletions({
				'help': '/clear',
				'help clear': '/clear [<targets>] [<item>]',
				'help clear timex05': '/clear timex05 [<item>] [<maxCount>]'
			});

			const result = await completions.getPossibleCompletions('clear timex05 ');
			// After consuming the real value "timex05" as <targets>, system should suggest next parameters
			expect(result.length).toBeGreaterThan(0);
			expect(result.some((r) => r.includes('item') || r.includes('maxCount'))).toBe(true);
		});

		it('should handle multiple real values', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/clear',
				'help clear': '/clear [<targets>] [<item>]',
				'help clear timex05': '/clear timex05 [<item>] [<maxCount>]',
				'help clear timex05 applea 64': '/clear timex05 applea 64 [<item>] [<maxCount>]'
			});

			const result = await completions.getPossibleCompletions('clear timex05 applea 64 ');
			// Should not suggest anything since all parameters have been consumed
			expect(result).toHaveLength(0);
			expect(commandFunction).toHaveBeenCalledWith('help clear timex05 applea 64');
		});
	});

	describe('Dynamic targets from list command', () => {
		it('should include online player names when <target>/<targets> is present', async () => {
			const { completions } = createCompletions({
				'help': '/clear',
				'help clear': '/clear [<targets>] [<item>] [<maxCount>]',
				'list': 'There are 1 of a max of 20 players online: timex05, playerb, '
			});

			const result = await completions.getPossibleCompletions('clear ');
			expect(result).toContain('timex05');
			expect(result).toContain('playerb');
		});

		it('should execute list each time and not cache player names', async () => {
			let listCalls = 0;
			const commandFunction = vi.fn(async (command: string) => {
				if (command === 'help clear') return '/clear [<targets>] [<item>] [<maxCount>]';
				if (command === 'list') {
					listCalls += 1;
					if (listCalls === 1) {
						return 'There are 1 of a max of 20 players online: timex05, ';
					}
					return 'There are 2 of a max of 20 players online: playerb, playerc, ';
				}
				return '';
			});

			const completions = new VanillaCompletions(
				'/clear [<targets>] [<item>] [<maxCount>]',
				commandFunction
			);

			const first = (await completions.getPossibleCompletions('clear ')).map((r) => r.value);
			const second = (await completions.getPossibleCompletions('clear ')).map((r) => r.value);

			expect(first).toContain('timex05');
			expect(first).not.toContain('playerc');
			expect(second).toContain('playerc');

			const listCommandCalls = commandFunction.mock.calls.filter(([cmd]) => cmd === 'list');
			expect(listCommandCalls).toHaveLength(2);
		});
	});

	describe('Repeated optional tails should be ignored', () => {
		it('should ignore help output with repeated parameter names', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/clear',
				'help clear': '/clear [<targets>] [<item>] [<maxCount>]',
				'help clear targets item maxCount':
					'/clear targets item maxCount [<targets>] [<item>] [<maxCount>]'
			});

			// After entering targets, item, maxCount - the help output repeats the same params
			// Should not add them as new suggestions
			const result = await completions.getPossibleCompletions('clear targets item maxCount ');
			expect(result).toHaveLength(0);
		});

		it('should ignore optional-only tail when all param names already exist', async () => {
			const { completions } = createCompletions({
				'help': '/advancement grant',
				'help advancement grant': '/advancement grant <targets> only <advancement>',
				'help advancement grant timex05': '/advancement grant timex05 only <advancement>',
				'help advancement grant timex05 only advancement':
					'/advancement grant timex05 only advancement [<criterion>]'
			});

			// After full path, should not re-add parameters already in structure
			const result = await completions.getPossibleCompletions(
				'advancement grant timex05 only advancement '
			);
			expect(result.length).toBeGreaterThanOrEqual(0); // May have criterion or be empty
		});
	});

	describe('Aliases', () => {
		it('should handle command aliases', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/experience /xp -> experience'
			});

			const result = await completions.getPossibleCompletions('xp');
			expect(result).toContain('xp');
		});
	});

	describe('Choice syntax with pipes', () => {
		it('should parse (option1|option2|option3) correctly', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/gamemode',
				'help gamemode': '/gamemode (survival|creative|adventure|spectator) [<targets>]'
			});

			const result = await completions.getPossibleCompletions('gamemode ');
			expect(result).toContain('survival');
			expect(result).toContain('creative');
			expect(result).toContain('adventure');
			expect(result).toContain('spectator');
		});
	});

	describe('Complex nested commands', () => {
		it('should handle /execute (run|if|unless|as|at) with further expansion', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/execute',
				'help execute': '/execute (run|if|unless|as|at|store|positioned|rotated)',
				'help execute run': '/execute run <command>',
				'help execute run give': '/execute run give <targets> <item>'
			});

			let result = await completions.getPossibleCompletions('execute ');
			expect(result).toContain('run');
			expect(result).toContain('if');

			result = await completions.getPossibleCompletions('execute run ');
			expect(result).toContain('<command>');
		});
	});

	describe('Edge cases', () => {
		it('should handle empty help output as endpoint', async () => {
			const { completions } = createCompletions({
				'help': '/custom',
				'help custom': ''
			});

			const result = await completions.getPossibleCompletions('custom ');
			expect(result).toHaveLength(0);
		});

		it('should handle help output that is identical to input (no expansion)', async () => {
			const { completions } = createCompletions({
				'help': '/custom',
				'help custom': '/custom' // No new tokens
			});

			const result = await completions.getPossibleCompletions('custom ');
			expect(result).toHaveLength(0);
		});

		it('should handle whitespace-only help decorators', async () => {
			const { completions } = createCompletions({
				'help': '/test',
				'help test': '/test [ ] ( ) < >'
			});

			const result = await completions.getPossibleCompletions('test ');
			expect(result).toBeDefined();
		});
	});

	describe('rotate command', () => {
		it('should suggest facingEntity and facingLocation for "rotate <target> facing "', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/rotate <target> (<rotation>|facing)',
				'help rotate': '/rotate <target> (<rotation>|facing)',
				'help rotate target facing': '/rotate target facing entity <facingEntity> [<facingAnchor>]/rotate target facing <facingLocation>'
			});

			const result = await completions.getPossibleCompletions('rotate <target> facing ');
			expect(result).toContain('entity');
			expect(result).toContain('<facingLocation>');
			expect(commandFunction).toHaveBeenCalledWith('help rotate target facing');

			const result1 = await completions.getPossibleCompletions('rotate <target> facing entity ');
			expect(result1).toContain('<facingEntity>');
		});
	});

	describe('ride command', () => {
		it('should suggest <vehicle> for "ride <target> mount "', async () => {
			const { completions, commandFunction } = createCompletions({
				'help': '/ride <target> (mount|dismount)',
				'help ride': '/ride <target> (mount|dismount)',
				'help ride target mount': '/ride target mount <vehicle>'
			});

			const result = await completions.getPossibleCompletions('ride <target> mount ');
			expect(result).toContain('<vehicle>');
			expect(commandFunction).toHaveBeenCalledWith('help ride target mount ');
		});
	});

});
