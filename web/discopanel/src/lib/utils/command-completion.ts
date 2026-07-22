
export function parsePlayerListFromOutput(output: string): [number, string[]] {
    output = stripMinecraftColors(output);

    // Common formats:
    // "There are X of a max Y players online: player1, player2"
    // "There are X/Y players online: player1, player2"
    // "Players online (X): player1, player2"

    let count = 0;
    const players: string[] = [];

    // Extract player count
    const match = output.match(/(\d+)\s*(?:of|\/)/);
    if (match && match[1]) {
        count = parseInt(match[1], 10);
    }

    // Extract player names after colon
    const colonIdx = output.indexOf(":");
    if (colonIdx !== -1 && colonIdx < output.length - 1) {
        const playersPart = output.substring(colonIdx + 1);

        for (const name of playersPart.split(",")) {
            const cleaned = name.trim();

            if (cleaned !== "" && cleaned !== "None") {
                players.push(cleaned);
            }
        }
    }

    // If we found a count but no players, return the count
    if (count > 0 && players.length === 0) {
        return [count, []];
    }

    // If we found players, use their count
    if (players.length > 0) {
        return [players.length, players];
    }

    return [0, []];
}


export function stripMinecraftColors(text: string): string {
    // Remove Minecraft color codes (§ followed by a character)
    text = text.replace(/§./g, "");

    // Remove ANSI color codes
    text = text.replace(/\x1b\[[0-9;]*m/g, "");

    return text;
}