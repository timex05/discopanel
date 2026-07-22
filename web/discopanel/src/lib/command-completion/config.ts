import type Completions from '$lib/command-completion/completions';
import VanillaCompletions from '$lib/command-completion/modloaders/vanilla';
import { ModLoader } from '$lib/proto/discopanel/v1/common_pb';
import ForgeCompletion from './modloaders/forge';
import BukkitCompletions from './modloaders/bukkit';
import PaperCompletions from './modloaders/paper';
import PurpurCompletions from './modloaders/purpur';
import VanillaOldCompletions from './modloaders/vanilla-old';
import SpigotCompletions from './modloaders/spigot';



export interface VersionRange{
    min: string;
    max: string;
    completion: {
        create(helpProvider: (path: string) => Promise<string>): Promise<Completions>;
    };
}

export interface ModLoaderRule {
    modLoader: ModLoader;
    commandDocsUrl: string;
    versions: VersionRange[];
}

export const MOD_LOADER_WIKI_URLS = {
    MINECRAFT: 'https://minecraft.wiki/Commands',
    MINECRAFT_BASE: 'https://minecraft.wiki/Commands/',

    BUKKIT: 'https://bukkit.fandom.com/wiki/CraftBukkit_Commands',

    SPIGOT: 'https://www.spigotmc.org/wiki/spigot-commands/',

    PURPUR: 'https://purpurmc.org/docs/purpur/commands/',
    PURPUR_BASE: 'https://purpurmc.org/docs/purpur/commands/#',

    PAPER: 'https://docs.papermc.io/paper/reference/commands/',
    PAPER_BASE: 'https://docs.papermc.io/paper/reference/commands/#',
} as const;





export const compatibilityRules: ModLoaderRule[] = [
    {
        modLoader: ModLoader.VANILLA,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.MINECRAFT,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions },
            { min: '1.4', max: '1.12.2', completion: VanillaOldCompletions }
        ]
    },
    {
        modLoader: ModLoader.FABRIC,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.MINECRAFT,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions }
        ]
    },
    {
        modLoader: ModLoader.FORGE,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.MINECRAFT,
        versions: [
            { min: '1.13', max: '*', completion: ForgeCompletion }
        ]
    },
    {
        modLoader: ModLoader.NEOFORGE,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.MINECRAFT,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions }
        ]
    },
    {
        modLoader: ModLoader.QUILT,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.MINECRAFT,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions }
        ]
    },
    {
        modLoader: ModLoader.BUKKIT,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.BUKKIT,
        versions: [
            { min: '*', max: '*', completion: BukkitCompletions }
        ]
    },
    {
        modLoader: ModLoader.SPIGOT,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.SPIGOT,
        versions: [
            { min: '*', max: '*', completion: SpigotCompletions }
        ]
    },
    {
        modLoader: ModLoader.PURPUR,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.PURPUR,
        versions: [
            { min: '*', max: '*', completion: PurpurCompletions }
        ]
    },
    {
        modLoader: ModLoader.PAPER,
        commandDocsUrl: MOD_LOADER_WIKI_URLS.PAPER,
        versions: [
            { min: '*', max: '*', completion: PaperCompletions }
        ]
    },
    {
        modLoader: ModLoader.FOLIA,
        commandDocsUrl: 'https://docs.papermc.io/paper/reference/commands/',
        versions: [
            { min: '*', max: '*', completion: PaperCompletions }
        ]
    },


];
