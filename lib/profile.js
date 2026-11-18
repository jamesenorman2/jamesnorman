// James's profile, read from ABOUT.md (the single source) so every agent describes him the same way.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let text = '';
try { text = readFileSync(join(process.cwd(), 'ABOUT.md'), 'utf8'); } catch (e) { text = ''; }
const section = name => { const m = text.match(new RegExp(`## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`)); return m ? m[1].trim() : ''; };

export const SUMMARY = section('Summary') || 'James Norman is a Chartered Security Consultant and security leader with over 27 years of experience protecting people, assets and operations across critical national infrastructure and large-scale global capital projects.';
export const CREDENTIALS = section('Key credentials and qualifications');
// One paragraph for prompts: who James is, in the third person.
export const WHO = `James Norman is a Chartered Security Consultant and security leader with over 27 years of experience, specialising in protecting people, assets and operations across critical national infrastructure and large-scale global capital projects in the UK and the wider AMEA region (city-level masterplanning, aviation, energy, data centres, sporting arenas and CNI sites): physical and electronic security and counter-terrorism strategy, risk-based and right-sized. Credentials: BEng (Hons) Electrical & Electronic Engineering; CEng (IET); MIET; Principal Member of the Register of Security Engineers and Specialists (RSES, sponsored by NPSA); BRE SABRE Accredited Assessor and Registered Professional; SQSS-compliant consultant for BREEAM Hea 06. He is also a music producer and DJ, and fascinated by AI and AI agents.`;
