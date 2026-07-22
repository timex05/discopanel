import { rpcClient } from '$lib/api/rpc-client';
import { compatibilityRules, type VersionRange } from '$lib/command-completion/config';
import { GetMinecraftVersionsRequestSchema, type MinecraftVersion } from '$lib/proto/discopanel/v1/minecraft_pb';
import { create } from '@bufbuild/protobuf';

export type BaseCommand = {
	name: string;
	url: string;
	description?: string;
}

export type SuggestionResult = {
    value: string;
    isOptional: boolean;
    isArgument: boolean;
};

export default interface Completions {
	isCommandValid(command: string): Promise<boolean>;
	getBaseCommands(): Promise<BaseCommand[]>;
	getPossibleCompletions(input: string): Promise<SuggestionResult[]>; 
}

type CompatibilityResult = {
    commandDocsUrl: string;
    compatible: boolean;
    completionClass?: {
			create(helpProvider: (path: string) => Promise<string>): Promise<Completions>;
		}
};


function isVersionInRange(version: string, range: VersionRange, versions: MinecraftVersion[]): boolean {
    const minCheck = compareVersions(version, range.min, versions);
    const maxCheck = compareVersions(version, range.max, versions);

    // Version >= min AND version <= max
    return minCheck >= 0 && maxCheck <= 0;
}



export async function isModLoaderCompatible(modLoader: number | undefined, minecraftVersion: string): Promise<CompatibilityResult> {
    // if modLoader is invalid we can't provide a rule
    if (modLoader === undefined || modLoader === 0) {
        return { compatible: false, commandDocsUrl: '' };
    }

    // find rule for mod-loader
    const rule = compatibilityRules.find(r => r.modLoader === modLoader);
    if (!rule) return { compatible: false, commandDocsUrl: '' };

    // always provide the docs URL from the rule (even if not compatible)
    const baseResult: CompatibilityResult = { compatible: false, commandDocsUrl: rule.commandDocsUrl ?? '' };

    // if no minecraftVersion provided we can't check compatibility, but still return the URL
    if (!minecraftVersion) return baseResult;

    try {
        // fetch all minecraft versions
        const versions = await rpcClient.minecraft.getMinecraftVersions(create(GetMinecraftVersionsRequestSchema, {}));

        // check if version is in any of the compatible version ranges
        const isCompatible = rule.versions.some(range => isVersionInRange(minecraftVersion, range, versions.versions));
        const completionClass = isCompatible ? rule.versions.find(range => isVersionInRange(minecraftVersion, range, versions.versions))?.completion : undefined;

        return {
            compatible: isCompatible,
            commandDocsUrl: rule.commandDocsUrl ?? '',
            completionClass
        };
    } catch (_) {
        return baseResult;
    }
}

// compare versions by release time
export function compareVersions(v1: string, v2: string, mcVersion: MinecraftVersion[]): number {
	const mcVersion1: MinecraftVersion | undefined = mcVersion.find((v) => v.id === v1);
	const mcVersion2: MinecraftVersion | undefined = mcVersion.find((v) => v.id === v2);
	if (mcVersion1 && mcVersion2) {
		return mcVersion1.releaseTime.localeCompare(mcVersion2.releaseTime);
	}
	return 0;
}

