/**
 * Menu data we author from the photo pack.
 *
 * Names, prices, and taste tags are merchandising choices, not facts printed
 * on the products. Allergens stay "unknown" until a photo shows an ingredient
 * list. A picture of a peanut is not an allergen declaration.
 */

export const MACHINES = {
  coffee: {
    id: "coffee",
    name: "Boost Coffee",
    blurb: "Every drink is served hot, iced, or at room temperature.",
  },
  snacks: {
    id: "snacks",
    name: "Snacks Bot",
    blurb: "Packaged snacks. No drink temperature.",
  },
} as const;

export type MachineId = keyof typeof MACHINES;

export const TEMPERATURES = ["hot", "iced", "room"] as const;
export type Temperature = (typeof TEMPERATURES)[number];

export const TASTE_TAGS = [
  "plain",
  "strong",
  "bitter",
  "creamy",
  "sweet",
  "mild",
  "spiced",
  "chocolate",
  "fruity",
  "tart",
  "light",
  "rich",
  "savory",
  "salty",
  "crunchy",
  "chewy",
  "spicy",
  "nutty",
  "crispy",
] as const;

export type TasteTag = (typeof TASTE_TAGS)[number];

/** No photo in the pack shows a printed ingredient list. */
export type AllergenStatus = "unknown";

/**
 * "photo" — the menu name follows what the picture shows.
 * "contents-hidden" — the drink itself is not visible, so the name is only a label.
 */
export type NameBasis = "photo" | "contents-hidden";

export type CatalogItem = {
  id: string;
  machineId: MachineId;
  name: string;
  nameBasis: NameBasis;
  /** One line for the screen. Describes the photo. Not an allergen claim. */
  summary: string;
  /** What a person can see, for the agent. Not a lab result. */
  photoNote: string;
  priceCents: number;
  /** Repo-relative path under images/. */
  imagePath: string;
  tasteTags: readonly TasteTag[];
  allergens: AllergenStatus;
  /** Boost Coffee: every drink needs hot, iced, or room before the order is complete. */
  requiresTemperature: boolean;
};
