import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../config";
import PaperCompletions from "./paper";


export default class PurpurCompletions extends PaperCompletions {
    public static async create(commandFunction: (command: string) => Promise<string>): Promise<Completions> {
        const instance = new PurpurCompletions(commandFunction);
        await instance.initCommands();
        return instance;
    }
    
    async initCommands() {
        await super.initCommands();
        await super.addCommand('purpur', 'purpur', `${MOD_LOADER_WIKI_URLS.PURPUR_BASE}#purpur`);
    }
}