import AnsiToHtml from 'ansi-to-html';

// slight adjustments to the colors to make them more readable on light background
const LIGHT_BG_COLORS: Record<number, string> = {
    0: '#000000',  // §0 - black
    1: '#0000B3',  // §1 - dark_blue
    2: '#006600',  // §2 - dark_green
    3: '#006680',  // §3 - dark_aqua
    4: '#B30000',  // §4 - dark_red
    5: '#7A007A',  // §5 - dark_purple
    6: '#8A5200',  // §6 - gold
    7: '#52525B',  // §7 - gray
    8: '#27272A',  // §8 - dark_gray
    9: '#1D4ED8',  // §9 - blue
    10: '#15803D', // §a - green
    11: '#0E7490', // §b - aqua
    12: '#B91C1C', // §c - red
    13: '#7E22CE', // §d - light_purple
    14: '#854D0E', // §e - yellow
    15: '#000000'  // §f - white
};

// Correct mapping for ansi-to-html (expects indices 0-15 matching standard ANSI palette)
const DARK_BG_COLORS: Record<number, string> = {
    0: '#FFFFFF',  // §0 - black (mapped to white for visibility on dark surfaces)
    1: '#0000AA',  // §1 - dark_blue
    2: '#00AA00',  // §2 - dark_green
    3: '#00AAAA',  // §3 - dark_aqua
    4: '#AA0000',  // §4 - dark_red
    5: '#AA00AA',  // §5 - dark_purple
    6: '#FFAA00',  // §6 - gold
    7: '#AAAAAA',  // §7 - gray
    8: '#555555',  // §8 - dark_gray
    9: '#5555FF',  // §9 - blue
    10: '#55FF55', // §a - green
    11: '#55FFFF', // §b - aqua
    12: '#FF5555', // §c - red
    13: '#FF55FF', // §d - light_purple
    14: '#FFFF55', // §e - yellow
    15: '#FFFFFF'  // §f - white
};

// Builds a converter whose colors match the active theme
export function themedAnsiConverter(mode: string | undefined) {
    const light = mode === 'light';
    return new AnsiToHtml({
        fg: light ? '#3f3f46' : '#e8e8e8',
        bg: light ? '#f4f4f5' : '#000000',
        colors: light ? LIGHT_BG_COLORS : DARK_BG_COLORS,
        newline: false,
        escapeXML: true,
        stream: true
    });
}

export function parseMinecraftColors(text: string): string {
    const codes: Record<string, string> = {
        // Color codes mapping §0-§f to ANSI standard 0-15
        '0': '\x1b[30m', 
        '1': '\x1b[31m', 
        '2': '\x1b[32m', 
        '3': '\x1b[33m', 
        '4': '\x1b[34m', 
        '5': '\x1b[35m', 
        '6': '\x1b[36m', 
        '7': '\x1b[37m',

        '8': '\x1b[90m', 
        '9': '\x1b[91m', 
        'a': '\x1b[92m', 
        'b': '\x1b[93m', 
        'c': '\x1b[94m', 
        'd': '\x1b[95m', 
        'e': '\x1b[96m', 
        'f': '\x1b[97m',
    
        // Formatting codes
        'l': '\x1b[1m',  // bold
        'm': '\x1b[9m',  // strikethrough
        'n': '\x1b[4m',  // underlined
        'o': '\x1b[3m',  // italic
        'r': '\x1b[0m'   // reset
    };

    // Replace Minecraft formatting codes with ANSI escape sequences
    return text.replace(/§([0-9a-frlmno])/gi, (_, code) => {
        return codes[code.toLowerCase()] || '';
    }).concat('\x1b[0m');
}