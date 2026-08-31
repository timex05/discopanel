import { stripMinecraftColors } from "$lib/utils/command-completion";
import type { BaseCommand, SuggestionResult } from "../completions";
import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../constants";

type Command = {
    name: string;
    url?: string;
    description?: string;
    aliasFor?: string;
}

export default class BukktitCompletions implements Completions {
    protected baseCommands: Command[] = [];
    protected helpProvider: (command: string) => Promise<string>;

    protected constructor(helpProvider: (command: string) => Promise<string>) {
        this.helpProvider = async (cmd) => stripMinecraftColors(await helpProvider(cmd));
    }
    isCommandValid(command: string): Promise<boolean> {
        if(command === '') return Promise.resolve(true);
        if(command.startsWith(' ') || command.endsWith(' ')) return Promise.resolve(false); // namespaced commands are not valid for completion

        const firstToken = command.split(" ")[0];
        for (const baseCmd of this.baseCommands) {
            if (baseCmd.name.startsWith(firstToken)) {
                return Promise.resolve(true);
            }
        }
        return Promise.resolve(false);
    }

    public static async create(helpProvider: (command: string) => Promise<string>): Promise<Completions> {
        const instance = new BukktitCompletions(helpProvider);
        await instance.initCommands();
        return instance;
    }

    async getBaseCommands(): Promise<BaseCommand[]> {

        return this.baseCommands.map(cmd => {
            if(cmd.aliasFor) {
                const targetCmd = this.baseCommands.find(c => c.name === cmd.aliasFor);
                if(targetCmd) {
                    return {
                        name: cmd.name,
                        url: targetCmd.url ? targetCmd.url : "",
                        description: targetCmd.description
                    }
                }             
            }
            return {
                name: cmd.name,
                url: cmd.url ? cmd.url : "",
                description: cmd.description
            };
        });
    }

    async getPossibleCompletions(input: string): Promise<SuggestionResult[]> {

        if (input.length === 0) {
            return this.baseCommands.map(cmd => ({ value: cmd.name, isArgument: false, isOptional: false }));
        }
        if (input.split(" ").length > 1) {
            return []; // only support first token completion
        }

        return this.baseCommands
            .filter(cmd => cmd.name.startsWith(input))
            .map(cmd => ({ value: cmd.name, isArgument: false, isOptional: false }));
    }

    async initCommands() {
        await this.initCommandsForNamespace("minecraft", MOD_LOADER_WIKI_URLS.MINECRAFT_BASE);
        await this.initCommandsForNamespace("bukkit", MOD_LOADER_WIKI_URLS.BUKKIT, false);
        await this.initAliases();
        
    }
    async initAliases() {
        const rawHelp = await this.helpProvider('help aliases');
        const lines = rawHelp.split("\n");
        const firstLine = lines[0];
        const aliasLines = lines.slice(1);
        


        let pages = 1;

        const pagesMatch = firstLine.match(/(\d+)\s*\/\s*(\d+)/);
        if (pagesMatch) {
            const parsed = parseInt(pagesMatch[2], 10);
            if (!isNaN(parsed)) {
                pages = parsed;
            }
        }

        if(pages > 1) { 
            const pagePromises: Promise<string>[] = [];

            for (let i = 1; i <= pages; i++) {
                pagePromises.push(this.helpProvider(`help aliases ${i}`));
            }

            const allPagesOutputs = await Promise.all(pagePromises);

            for (const pageOutput of allPagesOutputs) {
                const pageLines = pageOutput.split("\n").slice(1);
                for (const line of pageLines) {
                    const match = line.match(/^(\/\S+):\s*Alias for\s+(\/\S+)$/);

                    if (match) {
                        const command = match[1].replace(/^\//, '');
                        const aliasFor = match[2].replace(/^\//, '');

                        this.baseCommands.push({ name: command, aliasFor });
                    }
                }
            }
            return;
        }

        for (const line of aliasLines) {
            const match = line.match(/^(\/\S+):\s*Alias for\s+(\/\S+)$/);

            if (match) {
                const command = match[1].replace(/^\//, '');
                const aliasFor = match[2].replace(/^\//, '');

                this.baseCommands.push({ name: command, aliasFor });
            }
        }
    }

    async initCommandsForNamespace(namespace: string, baseUrl: string, staticUrl: boolean = true) {
        const helpOutput = await this.helpProvider(`help ${namespace}`);
        const firstLine = helpOutput.split('\n')[0];

        let pages = 1;

        const pagesMatch = firstLine.match(/(\d+)\s*\/\s*(\d+)/);
        if (pagesMatch) {
            const parsed = parseInt(pagesMatch[2], 10);
            if (!isNaN(parsed)) {
                pages = parsed;
            }
        }

        // load pages
        const pagePromises: Promise<string>[] = [];

        for (let i = 1; i <= pages; i++) {
            pagePromises.push(this.helpProvider(`help ${namespace} ${i}`));
        }

        const allPagesOutputs = await Promise.all(pagePromises);

        const seen = new Set<string>();
        const rawCommandTasks: string[] = [];

        // parsing
        for (const pageOutput of allPagesOutputs) {
            const lines = pageOutput.split("\n").slice(1);

            for (const line of lines) {
                const match = line.match(/^(?:§.)*\s*(\/[^\s]+)\s*(?:§.)*\s*(.+)$/);
                if (!match) continue;

                let command = match[1].replace(/^\//, "");

                command = command.replace(namespace + ":", "");

                if (command.endsWith(":")) {
                    command = command.slice(0, -1);
                }

                if (seen.has(command)) continue;
                seen.add(command);


                rawCommandTasks.push(command);
            }
        }

        // description
        const descriptionPromises = rawCommandTasks.map(async (cmd) => {
            const descOutput = await this.helpProvider(
                `help ${cmd}`
            );

            const cleanDescription = descOutput.replaceAll("-", "");

            return {
                name: cmd,
                url: `${baseUrl}${staticUrl ? cmd : ""}`,
                description: cleanDescription
            };
        });

        const result = await Promise.all(descriptionPromises);

        this.mergeCommands(result);

    }

    mergeCommands(newCommands: Command[]) {
        const merged = [...this.baseCommands, ...newCommands];

        const uniqueMap = new Map<string, Command>();

        for (const cmd of merged) {
            uniqueMap.set(cmd.name, cmd);
        }

        this.baseCommands = Array.from(uniqueMap.values());
        this.baseCommands.sort((a, b) => a.name.localeCompare(b.name));
    }

    async addCommand(command: string, helpString: string, url: string,){
        const description = await this.helpProvider(helpString);
        const cleanDescription = description.replaceAll("-", "");

        const newCommands = [
            { name: command, url: url, description: cleanDescription }
        ];
        this.mergeCommands(newCommands);
    }
}