import { stripMinecraftColors } from "$lib/utils/command-completion";
import type { BaseCommand, SuggestionResult } from "../completions";
import type Completions from "../completions";
import { MOD_LOADER_WIKI_URLS } from "../constants";

type CmdNode = {
    value: string;
    isArgument: boolean;
    isOptional: boolean;
    children: CmdNode[];
}

type Token = {
    value: string;
    isArgument: boolean;
    isOptional: boolean;
};

export default class VanillaOldCompletions implements Completions {
    private root: CmdNode = {
        value: 'root',
        isArgument: false,
        isOptional: false,
        children: []
    };

    private constructor(private baseString: string, private helpProvider: (commandPath: string) => Promise<string>) {
        this.initializeTree();
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

    static async create(helpProvider: (commandPath: string) => Promise<string>): Promise<Completions> {

        const helpOutput = stripMinecraftColors(await helpProvider(`help`));
        const firstLine = helpOutput.split('\n')[0];

        let pages = 1;
        const pagesMatch = firstLine.match(/of\s*(\d+)/i);

        if (pagesMatch) {
            pages = Number(pagesMatch[1]) || 1;
        }

        // load pages
        const pagePromises: Promise<string>[] = [];

        for (let i = 1; i <= pages; i++) {
            pagePromises.push(helpProvider(`help ${i}`));
        }


        // --- Showing help page 1 of 10 (/help <page>) ---/advancement <grant|revoke|test> <player>/ban <name> [reason ...]/ban-ip <address|name> [reason ...]/banlist [ips|players]/blockdata <x> <y> <z> <dataTag>/clear [player] [item] [data] [maxCount] [dataTag]/clone <x1> <y1> <z1> <x2> <y2> <z2> <x> <y> <z> [maskMode] [cloneMode]Tip: Use the <tab> key while typing a command to auto-complete the command or its arguments
        const raw = await Promise.all(pagePromises);
        const filtered = raw.map(output => {
            let cleaned = stripMinecraftColors(output);

            // remove header
            cleaned = cleaned.replace(
                /^(?:§[0-9a-fk-or])?---\s*Showing help page.*?---\s*\n?/i,
                ''
            );

            // remove tip
            const tipIndex = cleaned.indexOf('Tip:');
            if (tipIndex !== -1) {
                cleaned = cleaned.substring(0, tipIndex);
            }

            return cleaned.trim();
        });
        const cleanedOutput = filtered.join('').replaceAll('OR', '')
        const c = new VanillaOldCompletions(cleanedOutput, helpProvider);
        return c;
    }

    private initializeTree(): void {
        const commandLines = this.baseString.split('/').map(s => s.trim()).filter(s => s.length > 0);
        
        for (const line of commandLines) {
            const chunks = this.splitTopLevelChunks(line);
            const paths = this.generatePathsFromChunks(chunks);
            
            for (const path of paths) {
                this.insertPathIntoTree(path);
            }
        }
    }

    private insertPathIntoTree(path: Token[]): void {
        let currentNode = this.root;

        for (const token of path) {
            let nextNode = currentNode.children.find(child => 
                child.value === token.value && child.isArgument === token.isArgument
            );
            
            if (!nextNode) {
                nextNode = {
                    value: token.value,
                    isArgument: token.isArgument,
                    isOptional: token.isOptional,
                    children: []
                };
                currentNode.children.push(nextNode);
            }
            
            currentNode = nextNode;
        }
    }

    private generatePathsFromChunks(chunks: string[]): Token[][] {
        const paths: Token[][] = [];
        
        const recurse = (chunkIdx: number, currentPath: Token[], canSkipOptional: boolean) => {
            if (chunkIdx === chunks.length) {
                paths.push([...currentPath]);
                return;
            }
            
            const chunk = chunks[chunkIdx];
            
            if (chunk.startsWith('[') && chunk.endsWith(']')) {
                const content = chunk.slice(1, -1).trim();
                const subPaths = this.parseChunkContent(content, true);
                
                // optionals
                for (const subPath of subPaths) {
                    recurse(chunkIdx + 1, [...currentPath, ...subPath], true);
                }
                
                // skip optionals
                if (canSkipOptional) {
                    const hasRequiredAhead = chunks.slice(chunkIdx + 1).some(c => !c.startsWith('['));
                    if (hasRequiredAhead) {
                        recurse(chunkIdx + 1, currentPath, true);
                    } else {
                        paths.push([...currentPath]);
                    }
                }
            } else {
                const subPaths = this.parseChunkContent(chunk, false);
                for (const subPath of subPaths) {
                    recurse(chunkIdx + 1, [...currentPath, ...subPath], true);
                }
            }
        };
        
        recurse(0, [], true);
        return paths;
    }

    private parseChunkContent(content: string, isOptional: boolean): Token[][] {
        let isArgumentBlock = false;
        let inner = content;

        if (inner.startsWith('<') && inner.endsWith('>')) {
            isArgumentBlock = true;
            inner = inner.slice(1, -1).trim();
        }

        const alternatives = inner.split('|').map(s => s.trim());
        const paths: Token[][] = [];

        for (const alt of alternatives) {
            const subChunks = this.splitTopLevelChunks(alt);

            if (subChunks.length > 1) {
                let subPaths: Token[][] = [[]];
                for (const sc of subChunks) {
                    const scPaths = this.parseChunkContent(sc, isOptional);
                    const nextSubPaths: Token[][] = [];
                    for (const sp of subPaths) {
                        for (const scp of scPaths) {
                            nextSubPaths.push([...sp, ...scp]);
                        }
                    }
                    subPaths = nextSubPaths;
                }
                paths.push(...subPaths);
            } else {
                let term = subChunks[0] || alt;
                if (term.endsWith('...')) term = term.slice(0, -3).trim();

                const isArg = isArgumentBlock && isOptional;

                paths.push([{
                    value: term,
                    isArgument: isArg,
                    isOptional: isOptional
                }]);
            }
        }

        return paths;
    }

    private splitTopLevelChunks(str: string): string[] {
        const chunks: string[] = [];
        let current = "";
        let depthSquare = 0;
        let depthAngle = 0;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (char === '[') depthSquare++;
            else if (char === ']') depthSquare--;
            else if (char === '<') depthAngle++;
            else if (char === '>') depthAngle--;

            if (char === ' ' && depthSquare === 0 && depthAngle === 0) {
                if (current.trim().length > 0) chunks.push(current.trim());
                current = "";
            } else {
                current += char;
            }
        }
        if (current.trim().length > 0) chunks.push(current.trim());
        return chunks;
    }

    async isCommandValid(command: string): Promise<boolean> {
        if (command.length === 0) return true;
        if (command.startsWith(' ') || command.endsWith(' ')) return false;

        const words = command.split(/ +/).filter(w => w.length > 0);
        if (words.length === 0) return false;

        return this.checkValid(this.root, words, 0);
    }

    private checkValid(node: CmdNode, words: string[], wordIdx: number): boolean {

        // check if all remaining children are optional
        if (wordIdx === words.length) {
            return !node.children.some(child => !child.isOptional);
        }

        const currentWord = words[wordIdx];
        let matchedAnyChild = false;

        for (const child of node.children) {
            const isMatch = child.isArgument || child.value === currentWord;
            if (isMatch) {
                matchedAnyChild = true;
                if (this.checkValid(child, words, wordIdx + 1)) {
                    return true;
                }
            }
        }

        // commands can go on because help doesn't always show the full command structure even command expantion doesn't work in this low versions
        if (!matchedAnyChild && !node.children.some(child => !child.isOptional)) {
            return true;
        }

        return false;
    }

    async getPossibleCompletions(input: string): Promise<SuggestionResult[]> {
        const endsWithSpace = input.endsWith(' ');
        const trimmed = input.trim();

        let completedWords: string[] = [];
        let currentPrefix = "";

        if (input === "" || trimmed === "") {
            completedWords = [];
            currentPrefix = "";
        } else if (endsWithSpace) {
            completedWords = trimmed.split(/ +/).filter(w => w.length > 0);
            currentPrefix = "";
        } else {
            const words = trimmed.split(/ +/).filter(w => w.length > 0);
            completedWords = words.slice(0, -1);
            currentPrefix = words[words.length - 1];
        }

        const activeNodes: CmdNode[] = [];
        this.findActiveNodes(this.root, completedWords, 0, activeNodes);

        const suggestionsMap = new Map<string, SuggestionResult>();

        for (const activeNode of activeNodes) {
            for (const child of activeNode.children) {

                // don't filter argument
                if (currentPrefix && !child.isArgument) {
                    if (!child.value.toLowerCase().startsWith(currentPrefix.toLowerCase())) {
                        continue;
                    }
                }

                suggestionsMap.set(child.value, {
                    value: child.value,
                    isOptional: child.isOptional,
                    isArgument: child.isArgument
                });
            }
        }

        return Array.from(suggestionsMap.values());
    }

    private findActiveNodes(node: CmdNode, words: string[], wordIdx: number, result: CmdNode[]) {
        if (wordIdx === words.length) {
            result.push(node);
            return;
        }

        const currentWord = words[wordIdx];
        for (const child of node.children) {
            const isMatch = child.isArgument || child.value === currentWord;
            if (isMatch) {
                this.findActiveNodes(child, words, wordIdx + 1, result);
            }
        }
    }
}
