import { MAPPING_SOURCE_LABELS, type ResolvedUseMap } from "@/core/sprinkler/use-map";

import { UseMapForm } from "./use-map-form";

export type UseMapScreenProps = { companyName: string; resolved: ResolvedUseMap };

/**
 * Story 10.12 (FR72): Company → 4541 settings for the company's admins: the
 * default hazard class of each use, for the zones their people draw from now on.
 */
export function UseMapScreen({ companyName, resolved }: UseMapScreenProps) {
  const { map, source } = resolved;
  const own = source === "company";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-ad-xl font-semibold">4541 settings</h1>
        <p className="text-ad-sm text-muted">
          How {companyName} classifies spaces. A new zone starts as the default use, and choosing a use for a zone gives it that use&apos;s
          hazard class. Zones already drawn keep their use and hazard class. The rule figures of each hazard class (NZS 4541) are not
          changed here.
        </p>
      </div>
      <section aria-labelledby="use-map-heading" className="flex flex-col gap-3">
        <h2 id="use-map-heading" className="text-ad-md font-semibold">
          Use → hazard class
        </h2>
        <p className="text-ad-sm" data-testid="use-map-source">
          {own
            ? `${companyName} has its own mapping (v${map.version}).`
            : `${companyName} follows the ${MAPPING_SOURCE_LABELS[source].toLowerCase()}${map.verified ? "" : " (a draft, not yet verified)"}. Saving makes a mapping of your own, starting from it.`}
        </p>
        {/* Keyed by what is saved: after a save or a reset the form starts again from the stored mapping. */}
        <UseMapForm key={`${source}-${map.version}`} source={source} defaultUse={map.defaultUse} uses={map.uses} />
      </section>
    </div>
  );
}
