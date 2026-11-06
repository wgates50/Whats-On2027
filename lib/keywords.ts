// Distinctive words from each listing's title and description — artists' names, materials, subjects —
// so Discover can connect things properly: "Because you saved The 90s: Art and Fashion · Westwood,
// tailoring" rather than two things merely sharing "Contemporary art". Worked out at build time over
// all current listings (a word that's in every other description doesn't connect anything).

/** Common words, and words every listing uses ("exhibition", "tickets", "London"…). */
const STOP = new Set(
  (
    "about above across after again against also although among another anyone around away back been before being below between beyond both bring brings brought " +
    "came cannot come comes coming could does doing done down during each either else even ever every feel find first five four from further gets give given gives " +
    "going gone good great have having here hers herself himself however into itself just keep know last later latest least less like little look made make makes " +
    "making many more most much must near need never next nine none only onto other others ours over part past perhaps please rather really said same seen several " +
    "shall should show shows since some something soon still such take takes taken than that their them themselves then there these they thing things this those " +
    "though three through throughout time times today together told too took toward towards under until upon very want well were what when where whether which while " +
    "whilst whom whose will with within without would year years your yours also amid across " +
    // what every listing says
    "exhibition exhibitions gallery galleries museum museums london londons show shows event events ticket tickets booking book books booked free entry admission " +
    "join explore discover experience experiences enjoy celebrate celebrating celebration special guest guests featuring feature features include includes including " +
    "presents present presenting presented programme programmes season seasons series part night nights evening evenings morning afternoon week weekend weekends " +
    "daily open opens opening opened closing close closes visit visitors visitor online live venue stage theatre theatres performance performances perform performed " +
    "performing audience audiences work works artist artists artwork artworks collection collections display displays piece pieces project projects create created " +
    "creating creative creativity people world life lives story stories new latest best whole full first second third major new british english international " +
    "national famous award winning acclaimed hour hours minute minutes date dates info information details please limited available suitable ages adults adult " +
    "children family families accessible access running time interval doors start starts begins tour tours talk talks session sessions " +
    // filler that reads like a subject but isn't one
    "become becomes became help helped helps helping shape shaped shaping explores exploring explored imagine imagined combine combines combining thriving " +
    "innovative anything everything nothing wrong condition conditions looking trace traces origin origins profession designing contemporary modern classic " +
    "commissioning commission commissioned episode episodes icon iconic vision visions place places britain inspired inspiring inspiration unique original " +
    "brand version moment moments journey journeys celebrated renowned legendary beloved stunning beautiful brilliant extraordinary incredible powerful " +
    "january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday " +
    "spring summer autumn winter tonight tomorrow decade decades century centuries"
  ).split(/\s+/),
);

/** Lower case, accents off, possessives and plurals folded ("Hicks's textiles" → hicks, textile). */
export function tokens(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !/^\d+$/.test(w) && !STOP.has(w))
    .map((w) => (w.length > 5 && w.endsWith("ies") ? `${w.slice(0, -3)}y` : w.length > 4 && /[^su]s$/.test(w) ? w.slice(0, -1) : w))
    .filter((w) => !STOP.has(w) && !/^\d+$/.test(w));
}

/**
 * Up to `n` distinctive words per listing: weighted by how often they appear in it (title twice) and
 * how rare they are across all listings. Words in more than 3% of listings are too common to connect.
 */
export function keywords(items: { id: string; title: string; description?: string; venueName?: string }[], n = 6): Map<string, string[]> {
  const docs = items.map((x) => {
    const tf = new Map<string, number>();
    const inTitle = new Set(tokens(x.title));
    for (const w of inTitle) tf.set(w, (tf.get(w) ?? 0) + 2);
    for (const w of tokens(x.description ?? "")) tf.set(w, (tf.get(w) ?? 0) + 1);
    for (const w of tokens(x.venueName ?? "")) tf.delete(w); // its own venue connects nothing
    return [x.id, tf, inTitle] as const;
  });
  const df = new Map<string, number>();
  for (const [, tf] of docs) for (const w of tf.keys()) df.set(w, (df.get(w) ?? 0) + 1);
  const total = Math.max(1, items.length);
  const out = new Map<string, string[]>();
  for (const [id, tf, inTitle] of docs) {
    const top = [...tf]
      // Too common connects everything; a word only one description uses is usually filler (a name in
      // the title is kept even when unique: it may match something you saved before).
      .filter(([w]) => (df.get(w) ?? 0) / total <= 0.03 && ((df.get(w) ?? 0) > 1 || inTitle.has(w)))
      .map(([w, f]) => [w, f * Math.log(total / (df.get(w) ?? 1))] as const)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, n)
      .map(([w]) => w);
    if (top.length) out.set(id, top);
  }
  return out;
}
