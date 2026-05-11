type CommandObject = {
    command: string,
    type: "literal" | "argument" | "choice" | "optional",
    aliasses: string[],
    subcommands: CommandObject[],
    isEndpoint: boolean
}

class Completions {

    private commands: CommandObject[] = [];
    private mappings: Record<string, string[]>;
    private helpFunc: (command: string) => Promise<string>;

    constructor(baseHelpString: string, mappings: Record<string, string[]>, helpFunc: (command: string) => Promise<string>) {
        this.commands = this.parseCommands(baseHelpString);
        this.mappings = mappings;
        this.helpFunc = helpFunc;

    }

    private parseCommands(raw: string): CommandObject[] {
        let COMMANDS: CommandObject[] = [];
        let aliases: { [key: string]: string }[] = [];

    
        const commands: string[] = raw.split("/");
    

        for(let cmd of commands){
            if (cmd.includes("->")){
                let splittet: string[] = cmd.split("->").map(x => x.trim())
                aliases.push({[splittet[0]]: splittet[1]})

            } else {
                let tokens: string[] = cmd.split(" ").map(x => x.trim());
                let baseToken = tokens[0];
                let commandObject: CommandObject = {
                    command: baseToken,
                    type: "literal",
                    subcommands: [],
                    aliasses: [],
                    isEndpoint: false
                }

                for(let i: number = 1; i < tokens.length; i++){
                    let token = tokens[i];
                    if(token == "") continue;
                    let childs = this.getChilds(commandObject);
                    if(token.startsWith("<") && token.endsWith(">")){
                        childs.forEach((element: CommandObject) => {
                            const child: CommandObject = {
                                command: token,
                                type: "argument",
                                subcommands: [],
                                aliasses: [],
                                isEndpoint: false
                            };
                        
                            element.subcommands.push(child);
                        });
                    } else if(token.startsWith("[") && token.endsWith("]")){
                        childs.forEach((element: CommandObject) => {
                            const child: CommandObject = {
                                command: token,
                                type: "optional",
                                subcommands: [],
                                aliasses: [],
                                isEndpoint: false
                            };
                            element.subcommands.push(child);
                        });
                    } else if(token.startsWith("(") && token.endsWith(")")){
                        token = token.substring(1, token.length - 1);

                        token.split("|").forEach((element: string) => {
                            childs.forEach((el: CommandObject) => {
                                const child: CommandObject = {
                                    command: element,
                                    type: "choice",
                                    subcommands: [],
                                    aliasses: [],
                                    isEndpoint: false
                                };
                                el.subcommands.push(child);
                            });
                        });
                    }
                    else {
                        childs.forEach((element: CommandObject) => {
                            const child: CommandObject = {
                                command: token,
                                type: "literal",
                                subcommands: [],
                                aliasses: [],
                                isEndpoint: false
                            };
                            element.subcommands.push(child);
                        })
                    }
                }
                COMMANDS.push(commandObject);
            }     

        } 

        aliases.forEach(element => {
            let command = element[Object.keys(element)[0]];
            let alias = Object.keys(element)[0];
            let commandObject = COMMANDS.find(x => x.command == command);
            if(commandObject) {
                commandObject.aliasses.push(alias);
            }
        });
        return COMMANDS;
    }

    private getChilds(commandObject: CommandObject): CommandObject[] {
        // Wenn dieser Knoten keine Subcommands hat, ist er ein Blatt
        if(commandObject.subcommands.length === 0){
            return [commandObject];
        }

        // Ansonsten rekursiv in alle Subcommands gehen und Blätter sammeln
        let childs: CommandObject[] = [];
        commandObject.subcommands.forEach(element => {
            childs.push(...this.getChilds(element));
        });
        return childs;
    }

    private tokenizeCommand(command: string): string[] {
        const trimmed = command.trim();
        return trimmed === '' ? [] : trimmed.split(/\s+/);
    }

    private createCommandObject(token: string): CommandObject {
        let commandType: CommandObject['type'] = 'literal';
        let command = token;

        if (token.startsWith('<') && token.endsWith('>')) {
            commandType = 'argument';
        } else if (token.startsWith('[') && token.endsWith(']')) {
            commandType = 'optional';
        } else if (token.startsWith('(') && token.endsWith(')')) {
            commandType = 'choice';
            command = token.substring(1, token.length - 1);
        }

        return {
            command,
            type: commandType,
            subcommands: [],
            aliasses: [],
            isEndpoint: false
        };
    }

    private appendParsedTokens(commandObject: CommandObject, tokens: string[]): void {
        for (let index = 0; index < tokens.length; index++) {
            let token = tokens[index].trim();
            if (token === '') {
                continue;
            }

            const childs = this.getChilds(commandObject);
            if (token.startsWith('<') && token.endsWith('>')) {
                childs.forEach((element: CommandObject) => {
                    element.subcommands.push(this.createCommandObject(token));
                });
            } else if (token.startsWith('[') && token.endsWith(']')) {
                childs.forEach((element: CommandObject) => {
                    element.subcommands.push(this.createCommandObject(token));
                });
            } else if (token.startsWith('(') && token.endsWith(')')) {
                const choices = token.substring(1, token.length - 1).split('|');
                choices.forEach((choice) => {
                    const choiceToken = choice.trim();
                    childs.forEach((element: CommandObject) => {
                        element.subcommands.push(this.createCommandObject(choiceToken));
                    });
                });
            } else {
                childs.forEach((element: CommandObject) => {
                    element.subcommands.push(this.createCommandObject(token));
                });
            }
        }
    }

    private async mergeHelpOutput(commandObject: CommandObject, currentCommand: string): Promise<void> {
        if (commandObject.isEndpoint) {
            return;
        }

        const helpOutput = (await this.helpFunc(currentCommand.replace('<', "").replace('>', "").replace('[', "").replace(']', "").replace('|', "").replace('(', "").replace(')', ""))).trim();

        if (helpOutput.trim() == '') {
            commandObject.isEndpoint = true;
            return;
        }

        const inputTokens = this.tokenizeCommand(currentCommand);
        const outputTokens = this.tokenizeCommand(helpOutput);

        if (outputTokens.length <= inputTokens.length) {
            return;
        }
        

        const tailTokens = outputTokens.slice(inputTokens.length);

		this.appendParsedTokens(commandObject, tailTokens);
    }

    private collectChildCompletions(commandObject: CommandObject, currentToken: string): string[] {
        const output: string[] = [];

        commandObject.subcommands.forEach((element: CommandObject) => {
            if (element.command.startsWith(currentToken)) {
                output.push(element.command);
            }
            if (element.aliasses.some((alias) => alias.startsWith(currentToken))) {
                output.push(...element.aliasses.filter((alias) => alias.startsWith(currentToken)));
            }
            if (element.type === 'argument' || element.type === 'optional') {
                output.push(element.command);
            }
        });

        return Array.from(new Set(output));
    }

    private isMappedKey(value: string): boolean {
        return Object.prototype.hasOwnProperty.call(this.mappings, value);
    }

    private expandCompletions(completions: string[], currentToken: string): string[] {
        const expanded = completions.flatMap((completion) => {
            const mappedValues = this.mappings[completion] ?? [];
            const filteredMappedValues = mappedValues.filter((value) =>
                currentToken === '' || value.startsWith(currentToken)
            );

            if (!this.isMappedKey(completion)) {
                return [completion, ...filteredMappedValues];
            }

            return [...filteredMappedValues, completion];
        });

        const uniqueCompletions = Array.from(new Set(expanded));
        return uniqueCompletions.sort((left, right) => {
            const leftIsKey = this.isMappedKey(left);
            const rightIsKey = this.isMappedKey(right);

            if (leftIsKey && !rightIsKey) return 1;
            if (!leftIsKey && rightIsKey) return -1;
            return left.localeCompare(right);
        });
    }


    public async getPossibleCompletions(input: string): Promise<string[]> {
        const endsOnSpace: boolean = /\s$/.test(input);
        const trimmedInput = input.trim();
        const tokens: string[] = trimmedInput === "" ? [] : trimmedInput.split(/\s+/);
        if (endsOnSpace && tokens.length > 0) {
            tokens.push("");
        }

        const firstToken: string = tokens[0] ?? "";
        if(tokens.length == 0) {
            let output: string[] = [];
            this.commands.forEach((element: CommandObject) => {
                output.push(element.command);
                output.push(...element.aliasses);
            });
            return this.expandCompletions(output, '');
        }

        if(tokens.length == 1 && !endsOnSpace) {
            let output: string[] = [];
            this.commands.forEach((element: CommandObject) => {
                if(element.command.startsWith(firstToken)){
                    output.push(element.command);
                }
                if(element.aliasses.some(x => x.startsWith(firstToken))){
                    output.push(...element.aliasses.filter(x => x.startsWith(firstToken)));
                }
            });

            const exact = this.commands.find(
                x => x.command === firstToken || x.aliasses.includes(firstToken)
            );

            return this.expandCompletions(output, firstToken);
        }

        const baseCommand: CommandObject | undefined = this.commands.find(x => x.command == firstToken || x.aliasses.includes(firstToken));
        if(!baseCommand) return [];


        let currendCommandObject: CommandObject = baseCommand;
        return this.expandCompletions(
            await this.rekursiveSearch(currendCommandObject, tokens.slice(1), firstToken),
            tokens.at(-1) ?? ''
        );
    }

    private async rekursiveSearch(commandObject: CommandObject, tokens: string[], commandPath: string): Promise<string[]> {
        const firstToken: string = tokens[0];
        const currentCommand = firstToken ? `${commandPath} ${firstToken}` : commandPath;

        if (commandObject.subcommands.length === 0 && !commandObject.isEndpoint) {
            await this.mergeHelpOutput(commandObject, currentCommand);
        }

        if(tokens.length == 1){
            return this.collectChildCompletions(commandObject, firstToken);
        }

        const next = commandObject.subcommands.find(
            x => x.command === firstToken || x.aliasses.includes(firstToken) || x.type == "argument"
        );

        if (next) {
            return this.rekursiveSearch(next, tokens.slice(1), currentCommand);
        }

        if (!commandObject.isEndpoint) {
            await this.mergeHelpOutput(commandObject, commandPath);
            const retry = commandObject.subcommands.find(
                x => x.command === firstToken || x.aliasses.includes(firstToken) || x.type == "argument"
            );

            if (retry) {
                return this.rekursiveSearch(retry, tokens.slice(1), currentCommand);
            }
        }


        return [];
    }
}

export default Completions;