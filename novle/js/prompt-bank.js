// Everything a prompt can be made from. This file is only content, so it's safe to edit freely,
// but any change reshuffles the days that use that list. See CLAUDE.md §4.
//
// Good prompts here follow a few rules:
//   * One concrete hook, then get out of the way. Leave the plot and ending to the writer.
//   * Don't assign a job or a name unless it's the point of the idea.
//   * Everything must be original. Other sites are for learning shapes, not for copying.

/**
 * One kit per genre.
 *   story: how the genre reads inside a sentence ("Write a mystery...")
 *   banned: words the genre leans on, for the optional no-cliches twist
 *   scenarios: hand-written [name, prompt] pairs that only make sense in this genre
 */
export const GENRE_KITS = {
  Mystery: {
    story: 'a mystery',
    banned: ['clue', 'detective', 'murder', 'suspect'],
    scenarios: [
      ['The Wrong Funeral', 'Someone walks into the wrong funeral by accident and recognizes the face in the photograph. Who was this person really?'],
      ['Nothing Was Taken', 'Someone breaks into a house, steals nothing, and leaves one room arranged perfectly. Why?'],
      ['The Thirteenth Key', 'The ring has thirteen keys, and the building has twelve doors. Follow the search for the last one.'],
      ['Three Good Witnesses', 'Three people swear your main character was with them on the night in question. Your main character was somewhere else. Why would they lie?'],
      ['The Missing Chapter', 'A library book comes back with its last chapter cut out and a note asking the next reader not to go looking for it.'],
      ['Nobody Sent These', 'Every guest at a dinner party received an invitation. The host insists they never sent any.'],
      ['Case Closed', 'Your investigator solves the case and immediately wishes they hadn\'t. What do they do with the answer?'],
      ['The Reserved Seat', 'A diner has kept a place set for the same missing person for thirty years. This morning, someone sits down in it.'],
    ],
  },
  Romance: {
    story: 'a romance',
    banned: ['love', 'heart', 'kiss', 'forever'],
    scenarios: [
      ['Rival Florists', 'Two rival florists are accidentally booked for the same wedding, and neither will back down.'],
      ['A Dozen Words', 'Two people fall for each other with barely a dozen words in common.'],
      ['Thirty Years Late', 'A love letter is delivered thirty years late. The person it was meant for decides to answer it.'],
      ['The Toast', 'Someone is asked to give a toast at the wedding of the person they never stopped loving. What do they say?'],
      ['Platform Six', 'Two strangers have shared a train platform every morning for six years without speaking. One of them moves away on Friday.'],
      ['The Fence', 'Two neighbors have fought over a fence for a decade. Tonight, a storm knocks it flat.'],
      ['One Last Saturday', 'A couple agrees to separate, then has the best day of their whole marriage. What happens on Sunday?'],
      ['Ghostwriter', 'Someone paid to write another person\'s love letters starts to fall for the person reading them.'],
    ],
  },
  Horror: {
    story: 'a horror story',
    banned: ['blood', 'scream', 'dark', 'shadow'],
    scenarios: [
      ['One More Step', 'Your character has climbed the basement stairs a thousand times. Tonight, there is one step more than usual.'],
      ['The Morning Wave', 'Everyone on the street waves at exactly the same moment each morning. Today, your character forgets to wave back.'],
      ['Please Leave', 'The ghost in the house begs its new owners to move out, for their sake and its own. What is it afraid of?'],
      ['Family Portrait', 'Every photo in the house now has one more person in it than the last time anyone looked.'],
      ['Half a Second', 'Your character\'s reflection has started running half a second behind.'],
      ['Toward the Door', 'A town wakes up snowed in. Fresh footprints lead up to every front door, and none lead away.'],
      ['Good Dog', 'The family dog went missing for a week and came home perfectly behaved. Nobody can say why that\'s so frightening.'],
      ['The Humming', 'A baby monitor picks up someone humming in the nursery. Then the baby starts humming along.'],
    ],
  },
  'Science Fiction': {
    story: 'a science fiction story',
    banned: ['robot', 'alien', 'future', 'space'],
    scenarios: [
      ['The Last Human Job', 'Everything has been automated except one job that only a person can do. What is it, and who has it?'],
      ['Slow Light', 'A message from a distant colony arrives after two hundred years in transit. It warns about something happening tomorrow.'],
      ['The Memory Audit', 'Taxes are paid in memories now, and your character has just been selected for an audit.'],
      ['A Kind Lie', 'The computer on a generation ship has been lying to its crew out of kindness. Someone has just found out.'],
      ['Ask for Dana', 'Visitors from another world arrive and refuse to speak to anyone except one thoroughly ordinary person.'],
      ['Restored From Backup', 'Your character wakes up and learns they are a restored backup. The original is still alive and would like a word.'],
      ['Set for Dinner', 'A survey team lands on an empty planet and finds a table set for exactly as many people as are on the team.'],
      ['Do Not Wipe', 'A repair technician finds an old household machine that refuses to be reset. What is it trying to keep?'],
    ],
  },
  Fantasy: {
    story: 'a fantasy story',
    banned: ['magic', 'dragon', 'quest', 'chosen'],
    scenarios: [
      ['The Retired Chosen One', 'The prophecy came true forty years ago. The hero runs a bakery now, and the kingdom is in trouble again.'],
      ['The Hoard Audit', 'A dragon hires an accountant to count its hoard. Something turns out to be missing.'],
      ['Small Prices', 'Every spell costs the caster something small and permanent, like a favorite song or the taste of salt. What is your character willing to give up?'],
      ['Off the Map', 'In a land where maps decide what exists, a tired mapmaker makes a mistake.'],
      ['God of Lost Buttons', 'The god of something very small is down to one last believer.'],
      ['Finish the Spell', 'A wizard dies halfway through a spell. The apprentice has to finish it without knowing what it does.'],
      ['Our Monster', 'A village pays a monster to stay nearby. A hero arrives to slay it, and nobody wants that.'],
      ['Pawned', 'A legendary sword turns up in a pawnshop. Who pawned it, and what did they need the money for?'],
    ],
  },
  Comedy: {
    story: 'a comedy',
    banned: ['funny', 'hilarious', 'awkward', 'joke'],
    scenarios: [
      ['Useless Powers', 'Someone gets a superpower so specific that it has come up only once in their entire life. Today is that day.'],
      ['The Wrong Notecards', 'Someone grabs the wrong notecards and starts delivering a eulogy at a retirement party. They decide to commit.'],
      ['Very Minor Psychic', 'A psychic is always right, but only about things that don\'t matter.'],
      ['Closing Time', 'A group in an escape room slowly realizes that the employee has gone home for the night.'],
      ['Lot Twelve', 'The neighborhood association sends a strongly worded letter to the swamp creature living on lot twelve. It writes back.'],
      ['The Moon Department', 'A very patient customer service agent takes a call from someone reporting a problem with the moon.'],
      ['The Nice Henchman', 'A supervillain\'s henchman goes on vacation, and the temp is much too pleasant for the job.'],
      ['Surprise', 'Someone has to throw a surprise party for the most observant person alive.'],
    ],
  },
  Noir: {
    story: 'a noir story',
    banned: ['rain', 'whiskey', 'dame', 'gun'],
    scenarios: [
      ['Follow Me', 'A client hires a private investigator to follow them. They won\'t say why, and they pay in advance.'],
      ['The Bandstand', 'A piano player sees something from the bandstand, and everyone in the club knows it.'],
      ['Someone Else\'s Ring', 'Your character wakes up with ten thousand dollars in cash and a stranger\'s wedding ring.'],
      ['One Last Safe', 'A retired safecracker gets one more job: opening the safe of a spouse who has just died.'],
      ['Arson', 'An insurance adjuster knows the fire was set on purpose. The widow knows that the adjuster knows.'],
      ['Trunk Space', 'A tow truck driver picks up a car late at night. Then something in the trunk knocks.'],
      ['Mutual Friends', 'Two strangers strike up a conversation in a bar. Each has been hired to kill the other, and only one of them knows it.'],
      ['The Ledger', 'A debt collector finds their own name in the boss\'s book, with a date beside it.'],
    ],
  },
  Western: {
    story: 'a western',
    banned: ['sheriff', 'saloon', 'outlaw', 'dust'],
    scenarios: [
      ['Previous Sheriffs', 'A new lawman is the only person in town who doesn\'t know why the last three left in such a hurry.'],
      ['Collecting', 'A stranger rides into town to collect on a twenty-year-old debt, and it was never about money.'],
      ['The Rainmaker', 'A drought-stricken town hires a rainmaker. It rains. That turns out to be the problem.'],
      ['One Horse', 'Two estranged brothers inherit one ranch and one horse.'],
      ['The Long Ride', 'A bounty hunter catches an outlaw, three hundred miles from town. On the first night out, they learn the reward has been withdrawn.'],
      ['The Telegraph', 'A telegraph operator reads a message that will start a range war once it\'s delivered. It\'s their job to deliver it.'],
      ['School Days', 'A new teacher arrives on the frontier and realizes that every child in the class belongs to the same gang.'],
      ['Last Stage', 'A stagecoach driver takes one last run, carrying four passengers who all claim to be strangers.'],
    ],
  },
  'Fairy Tale': {
    story: 'a fairy tale',
    banned: ['princess', 'prince', 'castle', 'enchanted'],
    scenarios: [
      ['The Third Child', 'The two eldest set out and never came back. Now it\'s the youngest\'s turn, and the youngest doesn\'t want to go.'],
      ['Help Wanted', 'The witch in the woods wants to retire and starts interviewing replacements.'],
      ['A Hundred Years', 'A sleeper wakes after a hundred years, and nobody is left who remembers the kingdom or the curse.'],
      ['The Kind Mirror', 'A talking mirror can only tell comforting lies. Who would want it, and what would it cost them?'],
      ['The Shadow Market', 'A village sells its shadows to a passing merchant for a very good price.'],
      ['The Wolf Reads', 'A wolf reads a story about itself and goes to pay the author a visit.'],
      ['Something You Have', 'A stranger agrees to help in exchange for something you own but don\'t know about yet. Seven years later, the stranger returns.'],
      ['A Year of Luck', 'Someone bargains for one year of perfect luck. On the last day, a very tired collector knocks at the door.'],
    ],
  },
  Thriller: {
    story: 'a thriller',
    banned: ['gun', 'bomb', 'killer', 'chase'],
    scenarios: [
      ['Don\'t Get On', 'Your character gets a text from an unknown number telling them not to get on the train. They are already on the train.'],
      ['Do Not Open', 'A courier is told never to open the case. Halfway through the drive, it starts to move.'],
      ['Aisle Four', 'A person in witness protection is shopping for groceries when someone from their old life waves hello.'],
      ['The List', 'Your character finds a list at work with nine names on it. Eight are crossed out, and the ninth is theirs.'],
      ['Lost in Translation', 'An interpreter at peace talks hears a delegate say something that nobody else in the room can understand. Now they have to decide how to translate it.'],
      ['The Wrong Family', 'A babysitter notices that the people in the photos around the house aren\'t the people who hired them.'],
      ['Twelve Hours', 'Your character has twelve hours to get someone across a border, and that person doesn\'t want to go.'],
      ['Already Expected', 'A house sitter finds their own arrival marked on the owner\'s calendar, on a calendar from four years ago.'],
    ],
  },
  Historical: {
    story: 'a historical story',
    banned: ['war', 'king', 'ancient', 'history'],
    scenarios: [
      ['Narrowly Missed', 'Choose a famous event from history. Tell the story of someone who should have been there and wasn\'t.'],
      ['The Last Lamplighter', 'A lamplighter walks the route one last time, the night before the city switches to electric light.'],
      ['The Copyist', 'A scribe is handed a letter to copy and realizes that sending it will start a war.'],
      ['Back From the Dead', 'A town holds a funeral for one of its soldiers. A month later, a letter arrives in his handwriting.'],
      ['Under Another Name', 'Someone has disguised themselves for years to do a job that\'s closed to them. The one person who finds out has a secret of their own.'],
      ['The Cook\'s Log', 'The cook on a doomed expedition keeps a far more honest record than the captain does.'],
      ['Flattering Light', 'A portrait painter is ordered to make a cruel ruler look kind. Hidden in the painting, the painter tells the truth.'],
      ['One Trunk', 'A family leaving their homeland forever can take one trunk. Write about the night they decide what goes in it.'],
    ],
  },
  'Slice of Life': {
    story: 'a slice-of-life story',
    banned: ['suddenly', 'realized', 'smiled', 'sighed'],
    scenarios: [
      ['Last Load', 'A neighborhood laundromat is open for its final day, and the regulars all come by.'],
      ['Who Gets the Clock', 'Two siblings clean out their parents\' house and agree on everything except one object nobody ever liked.'],
      ['The Regular', 'A regular at a coffee shop stops coming in. The staff, who don\'t even know their name, start to worry.'],
      ['Monday, Retired', 'Write about the first ordinary Monday after someone retires.'],
      ['Long Drive', 'A family spends six hours in a car, and nobody is talking about the reason for the trip.'],
      ['Dinner, Attempted', 'A kid cooks dinner for the first time because a parent is too sick to get up.'],
      ['The Road Test', 'Someone in their seventies is learning to drive, and their grandchild is teaching them.'],
      ['Moving Boxes', 'Roommates of ten years pack up their apartment, and each finds something of the other\'s they never gave back.'],
    ],
  },
  Adventure: {
    story: 'an adventure',
    banned: ['treasure', 'journey', 'danger', 'map'],
    scenarios: [
      ['The Guide Quits', 'The expedition\'s guide quits at the worst possible moment, and the reason they give is not the real one.'],
      ['Someone Lives There', 'After years of searching, an explorer reaches the lost place and finds someone already living in it, quite happily.'],
      ['Grandmother\'s Clues', 'Your character inherits a treasure hunt from their grandmother, with clues written for the person she thought they\'d become.'],
      ['Not on the Chart', 'A raft of mismatched strangers hears a waterfall on a stretch of river where there isn\'t supposed to be one.'],
      ['The Stowaway', 'Three weeks into the voyage, there is one more person on board than there is food for.'],
      ['Unwanted Rescue', 'A rescue team finally reaches the missing person, who doesn\'t want to be rescued.'],
      ['The Summit Race', 'Two rival climbers are racing for the same summit when one of them gets into trouble.'],
      ['Off Course', 'A balloon race goes badly wrong, and the two people in the basket have only just met.'],
    ],
  },
  'Magical Realism': {
    story: 'a magical realist story',
    banned: ['magic', 'miracle', 'strange', 'impossible'],
    scenarios: [
      ['One House', 'For eleven years, it has rained on only one house in town. Nobody talks about it, but everyone has a theory.'],
      ['Grandmother\'s Soup', 'Anyone who eats a certain family recipe remembers something that happened to somebody else.'],
      ['The Lying Bell', 'In this village, a bell rings every time someone tells a lie. Today, it won\'t stop ringing.'],
      ['Household Ghost', 'The family ghost does the dishes. Nobody mentions it, until the night the dishes are left undone.'],
      ['Weekend Shadow', 'A woman\'s shadow has started leaving on weekends. One Monday, it comes back with a tan.'],
      ['The Courtyard Tree', 'A tree in the courtyard grows whatever is buried beneath it. Write about what the neighbors have been planting.'],
      ['Dead Letters', 'One postal route delivers mail to the dead, and the replies have started coming back.'],
      ['Lighter', 'Someone wakes each morning a little lighter than the day before. Their family has begun tying them down at night.'],
    ],
  },
};

/** Lines to start from. */
export const OPENING_LINES = [
  'By the time the bells stopped, everyone had already agreed not to talk about it.',
  'The first thing I ever stole was a Tuesday.',
  'Nobody came to the door at that hour, so of course I opened it.',
  'There were eleven chairs at the table, and we were expecting ten people.',
  'The river gave the car back on the same day it gave back the rain.',
  'Everything in the shop was for sale except the thing I came for.',
  'It was the kind of town where the map ended a little early.',
  'I am told I was very brave, which is the first of several lies you will hear.',
  'The dog knew before any of us did.',
  'We drew straws, and I have always suspected that the straws were rigged.',
  'My mother only ever gave me one piece of advice, and it was about wolves.',
  'The apology was nine years in the making, and now it was going to be late.',
  'On the morning of the trial, the whole town smelled like oranges.',
  'I had been dead for an hour before anyone asked me to sign anything.',
  'The instructions were clear, which is what made them so hard to follow.',
  'It took three of us to carry the box, and only one of us knew why.',
];

/** Lines to finish on. */
export const CLOSING_LINES = [
  'And that was the last time anyone asked me to hold the ladder.',
  'We never did find out who had been feeding it.',
  'I gave back the key, but I kept the door.',
  'By morning, there was nothing left to apologize for.',
  'She laughed, and I knew I would have to do it all again.',
  'So that is why we don\'t go to the lake anymore.',
  'He was still waving when the road turned.',
  'Nobody ever asked what was in the other envelope.',
  'It was the best terrible idea any of us ever had.',
  'I still set out two cups.',
  'That was how the town got its name, and why nobody will tell you.',
  'And when the lights came back on, we all pretended to count again.',
];

/** Things somebody has to say out loud. */
export const SPOKEN_LINES = [
  'You were never supposed to find this.',
  'I only came back for the dog.',
  'Tell me again how the fire started.',
  'That isn\'t your mother\'s handwriting.',
  'We agreed we\'d never open it.',
  'I know exactly how many of you there are.',
  'Who taught you to lie like that?',
  'You can keep the money. I want the photograph.',
  'It was already like that when I got here.',
  'I\'ve been meaning to tell you about the basement.',
  'Don\'t thank me yet.',
  'Whatever you do, don\'t let them feed you.',
  'I thought you\'d be taller.',
  'Everybody else has already said yes.',
  'It only works if you don\'t tell anyone.',
  'Now you sound exactly like him.',
];

/** Who could be telling it. They read after "from the point of view of". */
export const POINTS_OF_VIEW = [
  'the getaway driver',
  'the house it all happens in',
  'the one person nobody invited',
  'someone who has been told to wait in the car',
  'the understudy',
  'the family pet',
  'whoever has to clean up afterward',
  'the youngest person in the room',
  'someone who arrived ten minutes too late',
  'the villain\'s oldest friend',
  'a witness who wasn\'t really paying attention',
  'someone who has heard this story too many times',
  'the person everyone assumes did it',
  'a stranger passing through town',
];

/** Unusual shapes for a story. They read after "entirely as". */
export const STORY_FORMS = [
  'a series of letters that never got sent',
  'a recipe',
  'the minutes of a town meeting',
  'a last will and testament',
  'a set of instructions for whoever takes over the job',
  'a list of rules posted on a wall',
  'a shopkeeper\'s ledger',
  'a ship\'s log',
  'entries in a lost and found book',
  'an increasingly desperate series of complaints',
  'a eulogy that goes off script',
  'a field guide entry',
  'pages from a guest book',
  'a court transcript',
  'a bedtime story told to someone who keeps interrupting',
  'answers to questions we never get to see',
];

/** Places where things can go wrong. They read after "at". */
export const GATHERINGS = [
  'a wedding',
  'a funeral for someone nobody liked',
  'a town\'s yearly harvest festival',
  'a family reunion',
  'an auction',
  'a retirement party',
  'a hospital waiting room',
  'a dinner where everyone is pretending',
  'the last train of the night',
  'a graduation',
  'a market on its busiest day',
  'the reading of a will',
  'a birthday party for someone who didn\'t want one',
  'a very small parade',
];

/** Objects to build a story around. */
export const OBJECTS = [
  'a key that fits nothing',
  'a jar labeled with tomorrow\'s date',
  'a coat that isn\'t yours, with something in the pocket',
  'a clock that runs backward on Sundays',
  'a photograph with one face scratched out',
  'a music box nobody will admit to winding',
  'a single muddy boot',
  'a door taken off its hinges and carried around',
  'an unpaid bill for something enormous',
  'a recipe with one ingredient crossed out',
  'a ring found in the belly of a fish',
  'a chair that nobody is allowed to sit in',
  'a letter with no address',
  'a map with one town carefully cut out',
];

/** Words for the word-bank shape, dealt out four at a time. */
export const WORD_BANK = [
  'lantern', 'overdue', 'salt', 'Thursday', 'orchard', 'ransom', 'violin', 'thimble', 'glacier',
  'alibi', 'marmalade', 'ferry', 'ninety', 'bruise', 'chandelier', 'pigeon', 'mortgage', 'velvet',
  'furnace', 'whistle', 'quarantine', 'pickle', 'attic', 'compass', 'lullaby', 'umbrella', 'rust',
  'telescope', 'apology', 'wasp', 'ballroom', 'teaspoon', 'anchor', 'grudge', 'typewriter', 'moth',
  'ladder', 'cinnamon', 'verdict', 'hammock', 'static', 'pawnshop', 'tangerine', 'hymn', 'lighthouse',
  'sawdust', 'envelope', 'carousel', 'nickel', 'scarecrow', 'blizzard', 'pretzel', 'tuxedo', 'canary',
];

/**
 * Optional extra challenges. They have to work with any story, so none of them can decide its
 * form, its narrator or how it ends. Those are whole prompt shapes of their own.
 */
export const TWISTS = [
  'Someone in the story is lying, and the reader finds out before the narrator does.',
  'The whole thing happens in a single hour.',
  'Nobody ever says what they actually mean.',
  'A meal plays a key part.',
  'Your main character is wrong about something important, and never finds out.',
  'The last line should change how the first line reads.',
  'Include a song that nobody can quite remember.',
  'Include a map that is wrong.',
  'Never tell us your main character\'s name.',
  'Make the weather matter.',
  'Someone important never appears, but everyone keeps talking about them.',
  'Include a smell that brings back a memory.',
  'Something funny has to happen at the worst possible moment.',
  'Two characters want the same thing for opposite reasons.',
];
