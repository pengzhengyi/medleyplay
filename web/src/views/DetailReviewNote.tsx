/** @file Explain the side effects of a prefilled Cleanup suggestion before it is saved. */

import type { Detail, Details, MissingDetailReview } from "../api";
import { DETAIL_FIELDS, type Own, previewOf } from "../library/details";
import { useWords } from "../locale";

const reviewedFields = [...DETAIL_FIELDS, { name: "cover", label: "Cover" }] as const;

/** Show changed fields and the split-song count for the reviewed suggestion. */
export function DetailReviewNote({
  review,
  details,
  own,
  changes,
  artistsChanged,
}: {
  readonly review: MissingDetailReview;
  readonly details: Details;
  readonly own: Own;
  readonly changes: Partial<Record<Detail, string | number | null>>;
  readonly artistsChanged: boolean;
}) {
  const t = useWords();
  const changeCount = Object.keys(changes).length;
  if (changeCount === 0 && !artistsChanged) return null;
  const draft = previewOf(details, own);
  const fields = reviewedFields.flatMap(({ name, label }) => {
    const before = details.shown[name]?.value ?? "";
    const after = draft[name]?.value ?? "";
    return name !== review.field && before !== after ? [{ name, label, before, after }] : [];
  });
  const exact =
    !artistsChanged &&
    changeCount === 1 &&
    changes[review.field] === review.value &&
    fields.length === review.impact.details.length &&
    fields.every(({ name, before, after }) =>
      review.impact.details.some(
        (change) => change.field === name && change.before === before && change.after === after,
      ),
    );
  const { affected_songs: affected, split_songs: split } = review.impact;
  const songFields = reviewedFields
    .filter(({ name }) => review.impact.song_fields.includes(name))
    .map(({ label }) => t(label))
    .join(", ");
  return (
    <section className="detail-review-note" aria-labelledby="detail-review-title">
      <h3 id="detail-review-title">{t("Review before saving")}</h3>
      <div aria-live="polite">
        {fields.length > 0 && (
          <ul>
            {fields.map(({ name, label, before, after }) => (
              <li key={name}>
                {name === "cover"
                  ? t(after === "" ? "The cover would be removed." : "The cover would change.")
                  : t("{{field}}: {{before}} → {{after}}", {
                      field: t(label),
                      before: before === "" ? t("blank") : String(before),
                      after: after === "" ? t("blank") : String(after),
                    })}
              </li>
            ))}
          </ul>
        )}
        {exact && affected > 0 && (
          <p>
            {affected === 1
              ? t("1 split song would also change: {{fields}}.", { fields: songFields })
              : t("{{total}} split songs would also change: {{fields}}.", {
                  total: affected,
                  fields: songFields,
                })}
          </p>
        )}
        {!exact && split > 0 && <p>{t("Split songs can inherit changes from this album file.")}</p>}
        {exact && split > 0 && affected === 0 && (
          <p>{t("No displayed details would change on the split songs.")}</p>
        )}
        <p>{t("Edit the fields below before saving. Nothing has been saved yet.")}</p>
      </div>
    </section>
  );
}
