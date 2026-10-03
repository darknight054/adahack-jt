// Icons are Lucide (ISC licence, lucide.dev), imported one by one so the bundle only carries these.
import {
  Bike, Building2, Bus, Camera, Car, Coffee, Croissant, Footprints, House, Leaf, TreeDeciduous, Trophy, Users,
} from 'lucide'

// Keys match mode ids, stop categories and ledger kinds.
export const ICONS = {
  walk: Footprints,
  cycle: Bike,
  bus: Bus,
  carshare: Car,
  car_park: Car,
  tree: TreeDeciduous,
  coffee: Coffee,
  breakfast: Croissant,
  scenic: Camera,
  office: Building2,
  home: House,
  people: Users,
  team_bonus: Trophy,
  earned: Leaf,
}

const attrs = (a) => Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(' ')

/** The icon as an SVG string, for Leaflet markers. */
export const iconSvg = (name, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
  `stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `${ICONS[name].map(([tag, a]) => `<${tag} ${attrs(a)}/>`).join('')}</svg>`
