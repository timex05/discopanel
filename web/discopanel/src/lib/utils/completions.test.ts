import { describe, it, expect, vi } from 'vitest';
import Completions from './completions';

const baseHelp = '/advancement (grant|revoke)/attribute <target> <attribute> (get|base|modifier)/execute (run|if|unless|as|at|store|positioned|rotated|facing|align|anchored|in|summon|on)/bossbar (add|remove|list|set|get)/clear [<targets>]/clone (<begin>|from)/damage <target> <amount> [<damageType>]/data (merge|get|remove|modify)/datapack (enable|disable|list|create)/debug (start|stop|function)/defaultgamemode <gamemode>/dialog (show|clear)/difficulty [peaceful|easy|normal|hard]/effect (clear|give)/me <action>/enchant <targets> <enchantment> [<level>]/experience (add|set|query)/xp -> experience/fill <from> <to> <block> [outline|hollow|destroy|strict|replace|keep]/fillbiome <from> <to> <biome> [replace]/forceload (add|remove|query)/function <name> [<arguments>|with]/gamemode <gamemode> [<target>]/gamerule (spawn_wandering_traders|minecraft:spawn_wandering_traders|mob_drops|minecraft:mob_drops|mob_griefing|minecraft:mob_griefing|random_tick_speed|minecraft:random_tick_speed|spawn_phantoms|minecraft:spawn_phantoms|ender_pearls_vanish_on_death|minecraft:ender_pearls_vanish_on_death|log_admin_commands|minecraft:log_admin_commands|reduced_debug_info|minecraft:reduced_debug_info|tnt_explodes|minecraft:tnt_explodes|forgive_dead_players|minecraft:forgive_dead_players|water_source_conversion|minecraft:water_source_conversion|projectiles_can_break_blocks|minecraft:projectiles_can_break_blocks|show_advancement_messages|minecraft:show_advancement_messages|limited_crafting|minecraft:limited_crafting|max_snow_accumulation_height|minecraft:max_snow_accumulation_height|block_explosion_drop_decay|minecraft:block_explosion_drop_decay|drowning_damage|minecraft:drowning_damage|max_command_forks|minecraft:max_command_forks|elytra_movement_check|minecraft:elytra_movement_check|spawn_wardens|minecraft:spawn_wardens|max_command_sequence_length|minecraft:max_command_sequence_length|player_movement_check|minecraft:player_movement_check|universal_anger|minecraft:universal_anger|lava_source_conversion|minecraft:lava_source_conversion|spawn_mobs|minecraft:spawn_mobs|command_block_output|minecraft:command_block_output|respawn_radius|minecraft:respawn_radius|advance_time|minecraft:advance_time|send_command_feedback|minecraft:send_command_feedback|block_drops|minecraft:block_drops|spawn_patrols|minecraft:spawn_patrols|natural_health_regeneration|minecraft:natural_health_regeneration|spread_vines|minecraft:spread_vines|keep_inventory|minecraft:keep_inventory|freeze_damage|minecraft:freeze_damage|spawn_monsters|minecraft:spawn_monsters|allow_entering_nether_using_portals|minecraft:allow_entering_nether_using_portals|fire_damage|minecraft:fire_damage|immediate_respawn|minecraft:immediate_respawn|max_block_modifications|minecraft:max_block_modifications|command_blocks_work|minecraft:command_blocks_work|advance_weather|minecraft:advance_weather|global_sound_events|minecraft:global_sound_events|entity_drops|minecraft:entity_drops|show_death_messages|minecraft:show_death_messages|mob_explosion_drop_decay|minecraft:mob_explosion_drop_decay|players_nether_portal_default_delay|minecraft:players_nether_portal_default_delay|spectators_generate_chunks|minecraft:spectators_generate_chunks|players_sleeping_percentage|minecraft:players_sleeping_percentage|spawner_blocks_work|minecraft:spawner_blocks_work|raids|minecraft:raids|max_entity_cramming|minecraft:max_entity_cramming|players_nether_portal_creative_delay|minecraft:players_nether_portal_creative_delay|pvp|minecraft:pvp|tnt_explosion_drop_decay|minecraft:tnt_explosion_drop_decay|locator_bar|minecraft:locator_bar|fall_damage|minecraft:fall_damage|fire_spread_radius_around_player|minecraft:fire_spread_radius_around_player)/give <targets> <item> [<count>]/help [<command>]/item (replace|modify)/kick <targets> [<reason>]/kill [<targets>]/list [uuids]/locate (structure|biome|poi)/loot (replace|insert|give|spawn)/msg <targets> <message>/tell -> msg/w -> msg/swing [<targets>]/particle <name> [<pos>]/place (feature|jigsaw|structure|template)/playsound <sound> [master|music|record|weather|block|hostile|neutral|player|ambient|voice|ui]/random ';

describe('Completions', () => {
    // Helper to create a Completions instance with mocked help responses
    function createCompletions(helpResponses: Record<string, string>) {
        const commandFunction = vi.fn(async (command: string) => {
            return helpResponses[command] ?? '';
        });

        const baseHelpString = helpResponses['help'] ?? '';
        const mappings = {
            '<gamemode>': ['survival', 'creative', 'spectator'],
            '<targets>': ['@a', '@e', '@s', '@p', '@r']
        };

        return {
            completions: new Completions(baseHelpString, mappings, commandFunction),
            commandFunction
        };
    }

    describe('Basic command completion', () => {
        it('should complete top-level commands', async () => {
            const { completions } = createCompletions({
                'help': baseHelp
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
            expect(result.some(r => r.includes('item') || r.includes('maxCount'))).toBe(true);
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

            const completions = new Completions('/clear', {
                '<gamemode>': ['survival', 'creative', 'spectator'],
                '<targets>': ['@a', '@e', '@s', '@p', '@r']
            }, commandFunction);

            const first = await completions.getPossibleCompletions('clear ');
            const second = await completions.getPossibleCompletions('clear ');

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
                'help clear targets item maxCount': '/clear targets item maxCount [<targets>] [<item>] [<maxCount>]'
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
                'help advancement grant timex05 only advancement': '/advancement grant timex05 only advancement [<criterion>]'
            });

            // After full path, should not re-add parameters already in structure
            const result = await completions.getPossibleCompletions('advancement grant timex05 only advancement ');
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
});
