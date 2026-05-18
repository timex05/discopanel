import { ModLoader } from '$lib/proto/discopanel/v1/common_pb';

export interface VersionRange {
    min: string;
    max: string;
}

export interface ModLoaderRule {
    modLoader: ModLoader;
    versions: VersionRange[];
}

export const compatibilityRules: ModLoaderRule[] = [
    {
        modLoader: ModLoader.VANILLA,
        versions: [
            { min: '1.13', max: '*' }
        ]
    },
    {
        modLoader: ModLoader.FABRIC,
        versions: [
            { min: '1.13', max: '*' }
        ]
    },
];
