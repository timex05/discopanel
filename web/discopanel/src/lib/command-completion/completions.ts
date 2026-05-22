
export default interface Completions {
	getBaseCommands(): Promise<string[]>;
	getPossibleCompletions(input: string): Promise<string[]>;   
}
