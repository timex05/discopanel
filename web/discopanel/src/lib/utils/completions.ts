type CommandObject = {
    command: string,
    type: "literal" | "argument" | "choice" | "optional",
    aliasses: string[],
    subcommands: CommandObject[],
    isEndpoint: boolean
}

class Completions {

    private commands: CommandObject[] = [];

    constructor(baseHelpString: string) {
        this.commands = this.parseCommands(baseHelpString);
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


    public getPossibleCompletions(input: string): string[] {
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
            return Array.from(new Set(output));
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

            // If the input exactly matches a command whose next expected tokens are only free-form
            // arguments, suppress repeating the command name as completion.
            const exact = this.commands.find(
                x => x.command === firstToken || x.aliasses.includes(firstToken)
            );
            if (
                exact &&
                output.length === 1 &&
                output[0] === exact.command &&
                exact.subcommands.length > 0 &&
                exact.subcommands.every(x => x.type === "argument" || x.type === "optional")
            ) {
                return [];
            }

            return Array.from(new Set(output));
        }

        const baseCommand: CommandObject | undefined = this.commands.find(x => x.command == firstToken || x.aliasses.includes(firstToken));
        if(!baseCommand) return [];


        let currendCommandObject: CommandObject = baseCommand;
        return Array.from(new Set(this.rekursiveSearch(currendCommandObject, tokens.slice(1))));        
    }

    private rekursiveSearch(commandObject: CommandObject, tokens: string[]): string[] {
        const firstToken: string = tokens[0];
        if(tokens.length == 1){
            let output: string[] = [];
            commandObject.subcommands.forEach((element: CommandObject) => {
                if(element.command.startsWith(firstToken)){
                    output.push(element.command);
                }
                if(element.aliasses.some(x => x.startsWith(firstToken))){
                    output.push(...element.aliasses.filter(x => x.startsWith(firstToken)));
                }
                if(element.type == "argument" || element.type == "optional"){
                    output.push(element.command);
                }

            });
            return Array.from(new Set(output));
        }

        const next = commandObject.subcommands.find(
            x => x.command === firstToken || x.aliasses.includes(firstToken) || x.type == "argument"
        );

        if (next) {
            return this.rekursiveSearch(next, tokens.slice(1));
        }


        return [];
    }
}

export default Completions;