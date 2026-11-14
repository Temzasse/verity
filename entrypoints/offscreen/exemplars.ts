import type { Category } from '@/utils/analysis';

/**
 * Few-shot examples for the on-device classifier. Each article sentence is embedded and compared
 * with these; it's flagged when it's much closer to a technique's examples than to the neutral
 * ones. Add examples (e.g. from the SemEval propaganda datasets) to improve accuracy.
 */
export type Exemplars = { technique: string; category: Category | 'neutral'; examples: string[] };

export const EXEMPLARS: Exemplars[] = [
  {
    technique: 'Neutral reporting',
    category: 'neutral',
    examples: [
      'The council approved the budget on Tuesday by a vote of seven to two.',
      'The company reported revenue of 4.2 billion pounds for the third quarter.',
      'According to the Office for National Statistics, inflation fell to 3.1 per cent in October.',
      'The minister said the policy would be reviewed next year.',
      'Police said the road was closed for several hours while officers investigated.',
      'The report was published by the Institute for Fiscal Studies on Monday.',
      'Temperatures are expected to reach 18C in the south east this weekend.',
      'A spokesperson for the hospital confirmed that two patients had been discharged.',
      'The match ended in a 1-1 draw after a late equaliser.',
      'Residents can comment on the planning application until the end of the month.',
      'The study, published in The Lancet, followed 12,000 adults over ten years.',
      'He joined the firm in 2015 and was promoted to director three years later.',
    ],
  },
  {
    technique: 'Loaded language',
    category: 'loaded-language',
    examples: [
      'The shameless government has unleashed yet another disastrous assault on hardworking families.',
      'Furious locals slammed the outrageous plans as a sickening betrayal.',
      'The disgraceful decision sparked chaos and fury across the country.',
      'Brits are being bled dry by this scandalous tax raid.',
      'The shocking report exposes a horrifying cover-up at the heart of the establishment.',
      'Motorists face a brutal crackdown under the barmy new rules.',
    ],
  },
  {
    technique: 'Name calling / labeling',
    category: 'propaganda',
    examples: [
      'These woke snowflakes and loony lefties want to destroy everything we hold dear.',
      'The out-of-touch metropolitan elite sneer at ordinary people.',
      'Eco-zealots and their militant mobs are holding the country to ransom.',
      'The so-called experts are nothing but traitors and cranks.',
      'Thugs and yobs have been allowed to run riot by soft-touch judges.',
    ],
  },
  {
    technique: 'Appeal to fear',
    category: 'propaganda',
    examples: [
      'If nothing is done, our towns will be overrun and our children will no longer be safe.',
      'Families are terrified as the threat grows closer every single day.',
      'Experts warn the deadly crisis could kill thousands unless action is taken now.',
      'Your savings could be wiped out overnight under these terrifying plans.',
      'Women and girls will be put in danger if this goes ahead.',
    ],
  },
  {
    technique: 'Flag-waving',
    category: 'propaganda',
    examples: [
      'Any true patriot who loves this great nation must stand against this.',
      'Britain must stand proud and refuse to bow to Brussels bureaucrats.',
      'Our brave heroes did not fight and die for this country to see it surrendered.',
      'It is time to put our own people first and take back control of our borders.',
    ],
  },
  {
    technique: 'Exaggeration',
    category: 'propaganda',
    examples: [
      'This is the worst disaster in the history of the country.',
      'Absolutely everyone agrees that the scheme is a total and utter failure.',
      'Millions of people are flooding in every single week with no end in sight.',
      'Nobody in their right mind could possibly support such madness.',
    ],
  },
  {
    technique: 'Unattributed claim',
    category: 'unsupported-claim',
    examples: [
      'Experts say the new policy will cost taxpayers billions.',
      'It is widely believed that the figures have been manipulated.',
      'Insiders claim ministers knew about the problem for months.',
      'Studies show that the vast majority of people are against the plans.',
      'Many people are saying the scheme is being abused on a huge scale.',
      'Sources suggest the true number could be ten times higher.',
    ],
  },
  {
    technique: 'Doubt / casting suspicion',
    category: 'propaganda',
    examples: [
      'Can we really trust anything the so-called scientists tell us any more?',
      'Questions are now being asked about what the minister is really hiding.',
      'Critics wonder whether the official figures can be believed at all.',
      'Is this really a coincidence, or is something more sinister going on?',
    ],
  },
  {
    technique: 'False dilemma',
    category: 'logical-fallacy',
    examples: [
      'Either we close the borders completely or we lose our country forever.',
      'You are either with us or you are with the criminals.',
      'There are only two options: scrap the scheme now or face total bankruptcy.',
    ],
  },
  {
    technique: 'Whataboutism / straw man',
    category: 'logical-fallacy',
    examples: [
      'But what about the hypocrites in the opposition who did exactly the same thing?',
      'Campaigners want to ban cars altogether and force everyone to live in caves.',
      'Why should we listen to them when their own party has a far worse record?',
    ],
  },
  {
    technique: 'Causal oversimplification',
    category: 'logical-fallacy',
    examples: [
      'Crime has soared because of immigration, plain and simple.',
      'House prices have rocketed entirely because of the new arrivals.',
      'The economy collapsed for one reason only: this government.',
    ],
  },
];
