import { rpcClient } from '$lib/api/rpc-client';
import { compatibilityRules, type VersionRange, type CompletionClass } from '$lib/command-completion/config';
import { GetMinecraftVersionsRequestSchema, type MinecraftVersion } from '$lib/proto/discopanel/v1/minecraft_pb';
import { create } from '@bufbuild/protobuf';

function isVersionInRange(version: string, range: VersionRange, versions: MinecraftVersion[]): boolean {
    const minCheck = compareVersions(version, range.min, versions);
    const maxCheck = compareVersions(version, range.max, versions);

    // Version >= min AND version <= max
    return minCheck >= 0 && maxCheck <= 0;
}

type CompatibilityResult = {
    compatible: boolean;
    completionClass?: CompletionClass;
};

export async function isModLoaderCompatible(modLoader: number | undefined, minecraftVersion: string): Promise<CompatibilityResult> {
    // invalid = nicht kompatibel
    if (modLoader === undefined || modLoader === 0 || !minecraftVersion) {
        return { compatible: false };
    }

    // find rule for mod-loader
    const rule = compatibilityRules.find(
        r => r.modLoader === modLoader
    );

    if (!rule) return { compatible: false };

    // fetch all minecraft versions
    const versions = await rpcClient.minecraft.getMinecraftVersions(create(GetMinecraftVersionsRequestSchema, {}));

    // check if version is in any of the compatible version ranges
    const isCompatible = rule.versions.some(range => isVersionInRange(minecraftVersion, range, versions.versions));
    return { compatible: isCompatible, completionClass: isCompatible ? rule.versions.find(range => isVersionInRange(minecraftVersion, range, versions.versions))?.completion : undefined };
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
