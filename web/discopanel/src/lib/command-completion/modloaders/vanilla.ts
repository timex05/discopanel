import { parsePlayerListFromOutput, stripMinecraftColors } from "$lib/utils/command-completion";
import type { BaseCommand, SuggestionResult } from "../completions";
import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../constants";

// internal tree structure
type CmdNode = {
    value: string;
    isArgument: boolean;
    isOptional: boolean;
    children: CmdNode[];
    isExpanded: boolean;
    aliasFor?: string;
};

export default class VanillaCompletions implements Completions {
    private root: CmdNode = { 
        value: '', 
        isArgument: false, 
        isOptional: false, 
        children: [], 
        isExpanded: true 
    };

    private mappings: Record<string, string[]> = {
        '<gamemode>': ['adventure', 'survival', 'creative', 'spectator'],
        '<targets>': ['@a', '@e','@n', '@s', '@p', '@r'],
        '<target>': ['@a', '@e', '@s', '@p', '@r']
    };

    private helpProvider: (commandPath: string) => Promise<string>;

    private commandProvider: (cmd: string) => Promise<string>;

    constructor(
        baseString: string,
        commandProvider: (commandPath: string) => Promise<string>
    ) {
        this.commandProvider = commandProvider;
        this.helpProvider = async (helpString: string) => {
            // console.log("Help provider called with helpString:", helpString);
            const replacedArguments = [];
            while (helpString.indexOf('<') !== -1) {
                const index = helpString.indexOf('<');
                const endIndex = helpString.indexOf('>', index);
                if (endIndex === -1) break;
                const token = helpString.substring(index, endIndex + 1);
                helpString = helpString.replace(token, token.slice(1, -1));
                replacedArguments.push(token);
            }
            let outString =  await commandProvider('help ' + helpString);

            for (const arg of replacedArguments) {
                outString = outString.replaceAll(arg.slice(1, -1), arg);
            }
            // console.log("Help provider returning:", outString);
            return stripMinecraftColors(outString);

        }
        this.parseCommandsString(baseString);
    }

    static async create(helpProvider: (commandPath: string) => Promise<string>): Promise<Completions> {
        const c = new VanillaCompletions(stripMinecraftColors(await helpProvider('help')), helpProvider);
        return c;
    }

    private parseCommandsString(cmdString: string) {        
        const parts = cmdString.split('/').map(s => s.trim()).filter(s => s.length > 0);
        
        for (const part of parts) {
            if (part.includes('->')) {
                // path aliasses (f.e.: "xp -> experience",  "execute at <targets> -> execute")
                const [aliasPath, target] = part.split('->').map(s => s.trim());
                const tokens = aliasPath.split(/\s+/).filter(s => s.length > 0);
                this.addSequenceToTree(this.root, tokens, target);
            } else {
                // regular path
                const tokens = part.split(/\s+/).filter(s => s.length > 0);
                this.addSequenceToTree(this.root, tokens);
            }
        }
    }

    private addSequenceToTree(parent: CmdNode, tokens: string[], aliasTarget?: string) {
        if (tokens.length === 0) return;
        
        const currentTokenGroup = this.parseTokenGroup(tokens[0]);
        const remainingTokens = tokens.slice(1);
        
        
        for (const t of currentTokenGroup) {

            let child = parent.children.find(c => c.value === t.value);
            if (!child) {
                child = { ...t, children: [], isExpanded: false };
                parent.children.push(child);

                // edge case, execute manually point run nodes children to root children, because "help execute run" should return "/execute run ..." but returns ""
                if(t.value == 'run' && parent.value == 'execute') {
                    child.children = this.root.children;
                }
                if(aliasTarget) {
                    child.aliasFor = aliasTarget;
                }
            }

            // alias only set when remaining tokens are 0, because alias is the end of path, othwerwiese add further
            if (remainingTokens.length === 0 && aliasTarget) {
                child.aliasFor = aliasTarget;
                child.isExpanded = false;
            } else {
                this.addSequenceToTree(child, remainingTokens, aliasTarget);
            }
        }
    }

    private parseTokenGroup(str: string, inheritedOptional: boolean = false): { value: string, isArgument: boolean, isOptional: boolean }[] {
        let isOptional = inheritedOptional;
        let val = str;

        if (val.startsWith('[') && val.endsWith(']')) {
            isOptional = true;
            val = val.slice(1, -1);
        }

        if (val.startsWith('(') && val.endsWith(')') || val.includes('|')) {
            let choicesString = val;
            if(val.startsWith('(') && val.endsWith(')')) choicesString = choicesString.slice(1, -1);
            const choicesArray = choicesString.split('|');
            return choicesArray.flatMap(choice => this.parseTokenGroup(choice, isOptional));
        }

        let isArgument = false;
        if (val.startsWith('<') && val.endsWith('>')) {
            isArgument = true;
        }

        return [{ value: val, isArgument, isOptional }];
    }

    private async expandNodeIfNeeded(node: CmdNode, pathStr: string) {
        if (node.children.length === 0 && !node.isExpanded && node !== this.root) {
            if (node.aliasFor) {
                // handle alias
                const targetNode = this.root.children.find(c => c.value === node.aliasFor);
                if (targetNode) {
                    await this.expandNodeIfNeeded(targetNode, targetNode.value);
                    node.children = targetNode.children;
                }
                node.isExpanded = true;
            } else if (!node.isOptional) {
                // call HelpProvider
                const helpSyntax = await this.helpProvider(pathStr);
                if (helpSyntax && helpSyntax.trim().length > 0) {
                    this.parseCommandsString(helpSyntax);
                }
                node.isExpanded = true;
            }
        }
    }

    public async getBaseCommands(): Promise<BaseCommand[]> {
        return this.root.children.flatMap(child => {
            return [{
                name: child.value,
                url: `${MOD_LOADER_WIKI_URLS.MINECRAFT_BASE}${child.value}`,
                description: ``
            }];        
        }).sort((a, b) => a.name.localeCompare(b.name));
    }

    public async isCommandValid(command: string): Promise<boolean> {
        if(command === '') return true; 
        if(command.endsWith(' ')) return false;
        const rawTokens = command.split(' ');
        const inputTokens: string[] = [];
        
        for (let i = 0; i < rawTokens.length; i++) {
            if (rawTokens[i] !== '' || i === rawTokens.length - 1) {
                inputTokens.push(rawTokens[i]);
            }
        }

        if (inputTokens.length === 0 || (inputTokens.length === 1 && inputTokens[0] === '')) {
            return false;
        }

        if(command.startsWith('help')) {
            return true;
        }

        let currentPaths: { node: CmdNode, pathStr: string }[] = [{ node: this.root, pathStr: "" }];

        for (let i = 0; i < inputTokens.length; i++) {
            const token = inputTokens[i];
            
            for (const path of currentPaths) {
                await this.expandNodeIfNeeded(path.node, path.pathStr);
            }

            const nextPaths: { node: CmdNode, pathStr: string }[] = [];
            for (const path of currentPaths) {
                for (const child of path.node.children) {
                    if ((child.isArgument && token.length > 0) || child.value === token) {

                        const name = child.aliasFor ? child.aliasFor : child.value;
                        let pathStr = !path.pathStr || child.aliasFor ? name: `${path.pathStr} ${name}`;
                        if(child.children === this.root.children) pathStr = '';

                        nextPaths.push({
                            node: child,
                            pathStr: pathStr
                        });
                    }
                }
            }
            
            currentPaths = nextPaths;
            
            if (currentPaths.length === 0) {
                return false;
            }
        }

        for (const path of currentPaths) {
            await this.expandNodeIfNeeded(path.node, path.pathStr);
            
            if (path.node.children.length === 0) {
                return true; 
            }
            
            const canEndHere = path.node.children.some(child => child.isOptional);
            if (canEndHere) {
                return true;
            }
        }

        return false;
    }

    public async getPossibleCompletions(input: string): Promise<SuggestionResult[]> {
        const rawTokens = input.split(' ');
        const tokens: string[] = [];
        if(input.startsWith(' ')) return []; 
        
        for (let i = 0; i < rawTokens.length; i++) {
            if (rawTokens[i] !== '' || i === rawTokens.length - 1) {
                tokens.push(rawTokens[i]);
            }
        }

        let currentPaths: { node: CmdNode, pathStr: string }[] = [{ node: this.root, pathStr: "" }];

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const isLast = i === tokens.length - 1;
            
            for (const path of currentPaths) {
                await this.expandNodeIfNeeded(path.node, path.pathStr);
            }

            if (isLast) {
                const suggestions: SuggestionResult[] = [];
                const seen = new Set<string>();
                
                for (const path of currentPaths) {
                    for (const child of path.node.children) {
                        if (child.isArgument || child.value.startsWith(token)) {
                            if (!seen.has(child.value)) {
                                seen.add(child.value);
                                suggestions.push({
                                    value: child.value,
                                    isArgument: child.isArgument,
                                    isOptional: child.isOptional
                                });
                            }
                        }
                    }
                }

                const mappingsToAppend = [];

                for(const suggestion of suggestions) {
                    const mappingValues = this.mappings[suggestion.value];
                    if(mappingValues && suggestion.isArgument) {
                        mappingsToAppend.push(...mappingValues.filter((mapping) => mapping.startsWith(token)).map(val => ({
                            value: val,
                            isArgument: true,
                            isOptional: suggestion.isOptional
                        })));
                    }
                    if(suggestion.isArgument && (suggestion.value === '<targets>' || suggestion.value === '<target>')) {
                        const listOutput = await this.commandProvider(`list`);
                        const [_, players] = parsePlayerListFromOutput(listOutput);
                        mappingsToAppend.push(...players.filter(p => p.startsWith(token)).map(player => ({
                            value: player,
                            isArgument: true,
                            isOptional: suggestion.isOptional
                        })));    
                    }
                }
                return [...suggestions, ...mappingsToAppend].sort((a, b) => {
                    if (a.isArgument) return -1; 
                    return a.value.localeCompare(b.value)
                });
            } else {
                const nextPaths: { node: CmdNode, pathStr: string }[] = [];
                for (const path of currentPaths) {
                    for (const child of path.node.children) {
                        const match = child.isArgument || child.value === token;
                        if (match) {
                            const name = child.aliasFor ? child.aliasFor : child.value;
                            let pathStr = !path.pathStr || child.aliasFor ? name: `${path.pathStr} ${name}`;
                            if(child.children === this.root.children) pathStr = '';
                            nextPaths.push({
                                node: child,
                                pathStr: pathStr
                            });
                        }
                    }
                }
                currentPaths = nextPaths;
                
                if (currentPaths.length === 0) {
                    return [];
                }
            }
        }
        return [];
    }
}