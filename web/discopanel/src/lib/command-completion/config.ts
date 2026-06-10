import type Completions from '$lib/command-completion/completions';
import VanillaCompletions from '$lib/command-completion/vanilla-completions';
import { ModLoader } from '$lib/proto/discopanel/v1/common_pb';


export type CompletionClass = new (commandFunction: (command: string) => Promise<string>) => Completions;

export interface VersionRange{
    min: string;
    max: string;
    completion: CompletionClass;
}

export interface ModLoaderRule {
    modLoader: ModLoader;
    versions: VersionRange[];
}

export const compatibilityRules: ModLoaderRule[] = [
    {
        modLoader: ModLoader.VANILLA,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions }
        ]
    },
    {
        modLoader: ModLoader.FABRIC,
        versions: [
            { min: '1.13', max: '*', completion: VanillaCompletions }
        ]
    },
];
