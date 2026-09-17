import type { GuestLanguage } from './guest-languages';

// Translations for the existing published rickshaw cards. Booking conditions,
// schedules and prices remain on the original tour detail page.
const cards: Record<string, Partial<Record<GuestLanguage, {title:string;description:string}>>> = {
  'attyrickshaw-bukchon-1h': {
    en: {title:'Bukchon Hanok Old Alleys',description:'A 60-minute rickshaw tour through Bukchon and its hanok village, recommended for first-time visitors. An alternative route is used on Sundays. Book at least 6 hours ahead.'},
    zh: {title:'北村韩屋古巷',description:'60分钟人力车游览，一次探索北村与韩屋村，适合首次来首尔的游客。周日改走替代路线。需至少提前6小时预约。'},
    ja: {title:'北村韓屋の路地めぐり',description:'北村と韓屋村の見どころを巡る60分の人力車ツアー。ソウルが初めての方におすすめです。日曜日は代替コースで運行。6時間前までの予約が必要です。'},
  },
  'attyrickshaw-landmark-90m': {
    en: {title:'Seoul Landmarks',description:'A 90-minute rickshaw tour featuring Gyeongbokgung Palace, the Blue House and Samcheong-dong. Discover landmarks you might miss from a car. Book at least 6 hours ahead.'},
    zh: {title:'首尔地标之旅',description:'90分钟人力车游览，以景福宫、青瓦台和三清洞为中心，探索乘车容易错过的首尔地标。需至少提前6小时预约。'},
    ja: {title:'ソウルのランドマーク',description:'景福宮・青瓦台・三清洞を中心に巡る90分の人力車ツアー。車では見逃しがちなソウルの見どころを楽しめます。6時間前までの予約が必要です。'},
  },
  'attyrickshaw-bukchon-vip-2h': {
    en: {title:'Bukchon Hanok VIP',description:'A 120-minute premium rickshaw tour including an experience inside a hanok, with time for photos and stories. An alternative route is used on Sundays. Book at least 6 hours ahead.'},
    zh: {title:'北村韩屋VIP体验',description:'120分钟精品人力车路线，包含韩屋内部体验，适合喜欢拍照、体验与故事的游客。周日改走替代路线。需至少提前6小时预约。'},
    ja: {title:'北村韓屋VIP',description:'韓屋内部の体験を含む120分のプレミアム人力車ツアー。写真・体験・物語を楽しみたい方に。日曜日は代替コースで運行。6時間前までの予約が必要です。'},
  },
};
export function guestTourCopy(tour:{slug:string;title:string;description:string|null},language:GuestLanguage) {
  return cards[tour.slug]?.[language] ?? {title:tour.title,description:tour.description};
}
