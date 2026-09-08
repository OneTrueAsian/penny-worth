/** Attribution for every bundled Noun Project icon actually wired into
 * the app (src/assets/icons/, used by accountIcons.tsx/categoryIcons.tsx/
 * bucketIcons.tsx) — shown in Settings ▸ Icon credits. Each one is
 * licensed CC BY 3.0 (thenounproject.com's "creative-commons-attribution"
 * tier), which requires crediting the work and its creator; this list is
 * that credit. Keep it in sync by hand if an icon is added/removed from
 * those three files — there's no automated link between "which PNGs are
 * imported" and this list. */
export type IconCredit = {
  name: string;
  description: string;
  nounProjectId: string;
  author: string;
};

export const ICON_CREDITS: IconCredit[] = [
  { name: "car-insurance", description: "car insurance", nounProjectId: "773642", author: "Gregor Cresnar" },
  { name: "checking", description: "bank account", nounProjectId: "8453773", author: "Arkinasi" },
  { name: "credit-card", description: "Credit Card", nounProjectId: "8013675", author: "MBR" },
  { name: "electric", description: "Lightning Bolt", nounProjectId: "5628461", author: "Jasmine" },
  { name: "fuel", description: "gas pump", nounProjectId: "6563145", author: "archer7" },
  { name: "gift-goal", description: "Gift", nounProjectId: "8112521", author: "Andi wiyanto" },
  { name: "groceries", description: "grocery cart", nounProjectId: "4747051", author: "popcornarts" },
  { name: "home-goal", description: "home improvement", nounProjectId: "7899801", author: "Icon Designer" },
  { name: "internet", description: "wifi", nounProjectId: "8289480", author: "SAADI ALA" },
  { name: "investment", description: "investment", nounProjectId: "8473137", author: "Ilyas Aji Furqon" },
  { name: "laptop-goal", description: "Laptop", nounProjectId: "8451274", author: "diyah farida" },
  { name: "loan", description: "loan", nounProjectId: "8464725", author: "waqiahtul mukarromah" },
  { name: "music", description: "Music Note", nounProjectId: "683649", author: "Knockout Prezo" },
  { name: "phone", description: "phone bill", nounProjectId: "8082807", author: "huijae Jang" },
  { name: "rent", description: "house payment", nounProjectId: "8191685", author: "Ahmad Roaayala" },
  { name: "restaurant", description: "Restaurant", nounProjectId: "8464669", author: "LUTFI GANI AL ACHMAD" },
  { name: "salary", description: "paycheck", nounProjectId: "8402884", author: "Amir Ali" },
  { name: "savings", description: "Piggy Bank", nounProjectId: "6970888", author: "Waldiz Production" },
  { name: "shopping", description: "shopping", nounProjectId: "8464010", author: "Romaldon" },
  { name: "streaming", description: "play video", nounProjectId: "8437681", author: "Graphtend" },
  { name: "subscription", description: "recurring payment", nounProjectId: "8451671", author: "rendicon" },
  { name: "transport", description: "Transportation", nounProjectId: "8455785", author: "Junaid Ali" },
  { name: "travel-goal", description: "travel suitcase", nounProjectId: "8220482", author: "Chaiconator" },
  { name: "water", description: "Water Bill", nounProjectId: "8438023", author: "Ahmad Roaayala" },
];
