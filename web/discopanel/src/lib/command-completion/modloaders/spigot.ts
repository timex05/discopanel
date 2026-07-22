import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../config";
import BukktitCompletions from "./bukkit";


export default class SpigotCompletions extends BukktitCompletions {
    public static async create(commandFunction: (command: string) => Promise<string>): Promise<Completions> {
        const instance = new SpigotCompletions(commandFunction);
        await instance.initCommands();
        return instance;
    }

    async initCommands() {
        await super.initCommands();
        await super.addCommand('spigot', 'spigot', MOD_LOADER_WIKI_URLS.SPIGOT);
    }
}