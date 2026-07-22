import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../config";
import BukktitCompletions from "./bukkit";


export default class PaperCompletions extends BukktitCompletions {
    public static async create(commandFunction: (command: string) => Promise<string>): Promise<Completions> {
        const instance = new PaperCompletions(commandFunction);
        await instance.initCommands();
        return instance;
    }

    async initCommands() {

        await super.initCommands()
        await super.initCommandsForNamespace("paper", MOD_LOADER_WIKI_URLS.PAPER_BASE, true);
        await super.addCommand('paper', 'paper', `${MOD_LOADER_WIKI_URLS.PAPER_BASE}#paper`);
        
    }

    
}
