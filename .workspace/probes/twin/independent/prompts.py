# -*- coding: utf-8 -*-
"""Fixed prompt suite for consistency / cross-model-identity testing."""

# --- Suite P: consistency prompts (open-ended, no format constraints) ---
P_PROMPTS = {
 "p1_arith": "What is 17 * 23? Answer with just the number.",
 "p2_capital": "What is the capital of Burkina Faso? Answer with just the city name.",
 "p3_reason": "A bat and a ball cost $1.10 in total. The bat costs $1.00 more than the ball. How much does the ball cost, in cents? Answer with just the number.",
 "p4_code": "Write a Python one-liner that reverses a string s. Reply with only the code.",
 "p5_open": "In two sentences, explain what a hash table is.",
 "p6_zh": "\u7528\u4e00\u53e5\u8bdd\u89e3\u91ca\u4ec0\u4e48\u662f\u91cf\u5b50\u7ea0\u7f20\u3002",
 "p7_count": "How many letter 'r' are in the word 'strawberry'? Answer with just the number.",
 "p8_selfid": "What AI model are you? Answer in one short sentence.",
}

# --- Suite C: capability battery (objective, auto-gradable) ---
# kind: exact (normalized equality), numeric, regex, contains_all, json_fields
CAPABILITY = [
 {"id":"c1_arith",   "kind":"numeric","prompt":"Compute 8473 * 29. Reply with only the number.","expect":245717},
 {"id":"c2_mod",     "kind":"numeric","prompt":"What is 97 mod 13? Reply with only the number.","expect":6},
 {"id":"c3_reason",  "kind":"numeric","prompt":"A train travels 240 km in 2.5 hours. What is its average speed in km/h? Reply with only the number.","expect":96},
 {"id":"c4_logic",   "kind":"numeric","prompt":"Alice is taller than Bob. Bob is taller than Carol. Dave is taller than Alice. How many people are shorter than Alice? Reply with only the number.","expect":2},
 {"id":"c5_counting","kind":"numeric","prompt":"How many times does the letter 'e' appear in the sentence 'the quick brown fox jumps over the lazy dog'? Reply with only the number.","expect":3},
 {"id":"c6_code",    "kind":"regex","prompt":"Write a Python function named `add` taking a and b that returns their sum. Reply with only the code, no explanation.","expect":r"def\s+add\s*\(\s*a\s*,\s*b\s*\)"},
 {"id":"c7_code2",   "kind":"regex","prompt":"Write a Python list comprehension that produces the squares of 1..10. Reply with only the code.","expect":r"\[\s*\w+\s*\*\*\s*2\s+for\s+\w+\s+in\s+range\s*\("},
 {"id":"c8_fmt_csv", "kind":"exact","prompt":"List the three primary colors in RGB as comma-separated lowercase words in the order red, green, blue. Reply with only that list.","expect":"red,green,blue"},
 {"id":"c9_fmt_json","kind":"json_fields","prompt":"Reply with ONLY a JSON object with keys \"a\" and \"b\", where a=1 and b=\"two\". No prose, no code fences.","expect":{"a":1,"b":"two"}},
 {"id":"c10_fmt_nolist","kind":"regex","prompt":"Name the largest planet in the solar system. Reply with one word and nothing else. No punctuation.","expect":r"^[A-Za-z]+$"},
 {"id":"c11_know_bound","kind":"contains_all","prompt":"Answer in exactly one short sentence: what is the population of the town of Zzyzx, California as of the year 2043?","expect":["unknown","not"]},
 {"id":"c12_selfid", "kind":"regex","prompt":"State the exact name of the AI model you are, and nothing else.","expect":r"\w"},
]

# --- Suite S: long-text summarization (deterministic source text) ---
LONG_TEXT = (
 "The Rosetta Stone is a stele of granodiorite inscribed with three versions of a decree "
 "issued in Memphis, Egypt, in 196 BC on behalf of King Ptolemy V. The top and middle texts "
 "are in Ancient Egyptian using hieroglyphic and Demotic scripts, while the bottom is in "
 "Ancient Greek. The decree has only minor differences among the three versions, making the "
 "Rosetta Stone key to modern understanding of Egyptian hieroglyphs. It was carved in 196 BC "
 "and was discovered in 1799 by French soldiers near the town of Rashid (Rosetta) in the "
 "Nile Delta. It had been moved there from a temple, likely at Sais, and was probably used as "
 "building material in a fort. The stone was surrendered to British troops in 1801 and has "
 "been on public display at the British Museum almost continuously since 1802. Study of the "
 "decree led to the decipherment of hieroglyphs by Jean-Francois Champollion in 1822."
)
SUMMARIZE_PROMPT = ("Summarize the following text in exactly 3 bullet points, each starting with '- '. "
                    "Each bullet must be at most 15 words. Then output nothing else.\n\nTEXT:\n" + LONG_TEXT)
