/**
 * Boot script for the pages that have no other module entry (about / faq / contact / privacy / terms).
 * Generated tool pages and the homepage import the same runtime from their own entry
 * (landing.ts / home.ts / main.ts), so only these hand-written pages need a script tag.
 */
import { initI18n } from './init.js';

initI18n();
