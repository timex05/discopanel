import { stripMinecraftColors } from "$lib/utils/command-completion";
import type Completions from "../completions";
import type { BaseCommand } from "../completions";
import VanillaCompletions from "./vanilla";


export default class ForgeCompletion extends VanillaCompletions{
    
    public async getBaseCommands(): Promise<BaseCommand[]> {
        return (await super.getBaseCommands()).map((cmd) => {
            if(cmd.name === 'forge') cmd.url = '';
            return cmd;
        });
    }

    static async create(helpProvider: (commandPath: string) => Promise<string>): Promise<Completions> {
        const cleanHelpProvider = async (cmd: string) => {
            const output = await helpProvider(cmd);
            return stripMinecraftColors(output);
        }
        const c = new ForgeCompletion(await cleanHelpProvider('help'), cleanHelpProvider);
        return c;
    }
}