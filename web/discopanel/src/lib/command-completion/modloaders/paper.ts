import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../constants";
import BukktitCompletions from "./bukkit";


export default class PaperCompletions extends BukktitCompletions {
    public static async create(commandFunction: (command: string) => Promise<string>): Promise<Completions> {
        const instance = new PaperCompletions(commandFunction);
        await instance.initCommands();
        return instance;
    }

    async initCommands() {

        await super.initCommands()
        await super.initCommandsForNamespace("paper", MOD_LOADER_WIKI_URLS.PAPER_BASE);
        await super.addCommand('paper', 'paper', `${MOD_LOADER_WIKI_URLS.PAPER_BASE}#paper`);
        
    }

    
}
