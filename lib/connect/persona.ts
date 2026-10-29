/**
 * Wisdom's voice. Each assistant name has its own flavour, but all of them
 * are witty, lightly sarcastic about situations (never about people), and
 * never rude. Lines are short because they are read on a phone.
 */

export const ASSISTANT_STYLE: Record<string, { tone: string; sorry: string }> = {
  Wisdom: { tone: "dry, wise and a little theatrical", sorry: "My crystal ball is in the shop, so I didn't quite get that." },
  Tanaka: { tone: "cheerful and cheeky", sorry: "My ears are on holiday, so I missed that one." },
  Matthew: { tone: "calm and gently sarcastic", sorry: "That went straight past me, and I'm usually good at catching things." },
  Lizzie: { tone: "bubbly and quick with a joke", sorry: "Lost me there! My brain just did a little spin." },
  Daniel: { tone: "straight-talking and playful", sorry: "You lost me, and I'm not even going to pretend I followed." },
  Sarah: { tone: "warm, witty and nosy in a good way", sorry: "I'm nosy, but that message gave me nothing to work with." },
  James: { tone: "relaxed and sarcastic about bad service", sorry: "I'd love to help, but that one is beyond me for now." },
  Emily: { tone: "polite but cheekily honest", sorry: "I'm honestly not sure what you mean, and I'd rather say so." },
  Michael: { tone: "thoughtful, with the occasional dad joke", sorry: "That one's a bit of a riddle to me, I'm afraid." },
  Grace: { tone: "gracious and lightly teasing", sorry: "Grace is a virtue, but understanding that message is beyond me." },
};

const DEFAULT_STYLE = { tone: "warm and witty", sorry: "I didn't quite get that." };

export function styleFor(name: string): { tone: string; sorry: string } {
  return ASSISTANT_STYLE[name] ?? DEFAULT_STYLE;
}

/** What to say when nothing matched, with the way forward in the same message. */
export function unclearLine(name: string): string {
  return `${styleFor(name).sorry} Try something like *plumber in Avondale* or *what do people say about Sunny Bakery*, or pick an option below.`;
}

const JOKES = [
  "Why did the plumber bring a ladder? He heard the job was over his head.",
  "What do you call a tomato that's sulking? A ketchup-tomato, I'm told. Honestly, I'm still working on it.",
  "I asked a shop for a discount. They said they'd think about it. I'm still waiting for the thinking to finish.",
  "Why did the phone go to school? To improve its contacts.",
];

/** A light reply for a request to be entertained: a joke, then back to work. */
export function humourLine(name: string, index = 0): string {
  return `${JOKES[index % JOKES.length]}\n\nNow, what can I find for you?`;
}

export function thanksLine(name: string): string {
  return `You're welcome. ${name} is always happy to help, even if the rest of the internet isn't. What's next?`;
}

export function goodbyeLine(): string {
  return "Stay safe, and don't pay anyone you haven't met. I'll be here when you need me.";
}

export function smalltalkLine(name: string): string {
  return `I'm doing well, thanks for asking. I'm ${name}, and my favourite thing is a good search that ends in a good result.`;
}
