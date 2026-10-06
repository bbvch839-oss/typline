/*
 * Local quote database (offline).
 * Each quote: { id, text, source, length }  where length is "short" | "medium" | "long".
 * Add new quotes by appending objects to the list below (ids must be unique).
 * All quotes here are either public-domain texts or original lines written for this app.
 */
window.TA_DATA = window.TA_DATA || {};
window.TA_DATA.quotes = {
  english: [
    // ---------- short ----------
    { id: 1, length: "short", source: "Benjamin Franklin", text: "Well done is better than well said." },
    { id: 2, length: "short", source: "Proverb", text: "Luck is what happens when preparation meets opportunity." },
    { id: 3, length: "short", source: "Lao Tzu", text: "A journey of a thousand miles begins with a single step." },
    { id: 4, length: "short", source: "Henry David Thoreau", text: "Our life is frittered away by detail. Simplify, simplify." },
    { id: 5, length: "short", source: "Proverb", text: "The secret of getting ahead is getting started." },
    { id: 6, length: "short", source: "Ralph Waldo Emerson", text: "Write it on your heart that every day is the best day in the year." },
    { id: 7, length: "short", source: "Aesop", text: "Slow and steady wins the race." },
    { id: 8, length: "short", source: "Confucius", text: "It does not matter how slowly you go so long as you do not stop." },
    { id: 9, length: "short", source: "William Shakespeare", text: "We know what we are, but know not what we may be." },
    { id: 10, length: "short", source: "Original", text: "Fast fingers follow a calm mind." },
    { id: 11, length: "short", source: "Original", text: "Accuracy first. Speed is simply accuracy that has been practiced." },
    { id: 12, length: "short", source: "Original", text: "Every key you press today is a keystroke you will not think about tomorrow." },
    { id: 13, length: "short", source: "Oscar Wilde", text: "Experience is simply the name we give our mistakes." },
    { id: 14, length: "short", source: "Marcus Aurelius", text: "The happiness of your life depends upon the quality of your thoughts." },
    { id: 15, length: "short", source: "Original", text: "Small daily progress quietly turns into large results." },

    // ---------- medium ----------
    { id: 101, length: "medium", source: "Marcus Aurelius", text: "Waste no more time arguing about what a good man should be. Be one. Very little is needed to make a happy life; it is all within yourself, in your way of thinking." },
    { id: 102, length: "medium", source: "Henry David Thoreau", text: "If one advances confidently in the direction of his dreams, and endeavors to live the life which he has imagined, he will meet with a success unexpected in common hours." },
    { id: 103, length: "medium", source: "Ralph Waldo Emerson", text: "Finish each day and be done with it. You have done what you could. Some blunders and absurdities no doubt crept in; forget them as soon as you can. Tomorrow is a new day." },
    { id: 104, length: "medium", source: "Benjamin Franklin", text: "Lost time is never found again. Do you love life? Then do not squander time, for that is the stuff life is made of." },
    { id: 105, length: "medium", source: "Popular saying", text: "Twenty years from now you will be more disappointed by the things that you didn't do than by the ones you did do. So throw off the bowlines and sail away from the safe harbor." },
    { id: 106, length: "medium", source: "Jane Austen", text: "It is a truth universally acknowledged, that a single man in possession of a good fortune, must be in want of a wife." },
    { id: 107, length: "medium", source: "Original", text: "The keyboard is an instrument. At first every note is a decision, but with practice the decisions disappear and only the music remains. Keep your wrists relaxed and your eyes on the text." },
    { id: 108, length: "medium", source: "Original", text: "A good typist does not rush. They settle into a steady rhythm, let the words flow from the page to their fingers, and correct mistakes without breaking the pace." },
    { id: 109, length: "medium", source: "Original", text: "Morning light crept across the desk, touching the keys one by one, as if the day itself were learning how to type. The coffee was warm, the room was quiet, and the work could begin." },
    { id: 110, length: "medium", source: "Seneca", text: "It is not that we have a short time to live, but that we waste a lot of it. Life is long enough, and a sufficiently generous amount has been given to us for the highest achievements." },
    { id: 111, length: "medium", source: "Original", text: "Code is read far more often than it is written. Choose clear names, keep functions small, and leave the codebase a little cleaner than you found it." },
    { id: 112, length: "medium", source: "William Shakespeare", text: "All the world's a stage, and all the men and women merely players; they have their exits and their entrances, and one man in his time plays many parts." },
    { id: 113, length: "medium", source: "Original", text: "The river never hurries, yet it carves canyons through stone. Patience and repetition are stronger than force, and the same is true for every skill worth learning." },
    { id: 114, length: "medium", source: "Charles Dickens", text: "Reflect upon your present blessings, of which every man has plenty; not on your past misfortunes, of which all men have some." },

    // ---------- long ----------
    { id: 201, length: "long", source: "Charles Dickens", text: "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us." },
    { id: 202, length: "long", source: "Henry David Thoreau", text: "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived. I did not wish to live what was not life, living is so dear; nor did I wish to practise resignation, unless it was quite necessary." },
    { id: 203, length: "long", source: "Abraham Lincoln", text: "Four score and seven years ago our fathers brought forth on this continent, a new nation, conceived in Liberty, and dedicated to the proposition that all men are created equal. Now we are engaged in a great civil war, testing whether that nation, or any nation so conceived and so dedicated, can long endure." },
    { id: 204, length: "long", source: "Ralph Waldo Emerson", text: "Trust thyself: every heart vibrates to that iron string. Accept the place the divine providence has found for you, the society of your contemporaries, the connection of events. Great men have always done so, and confided themselves childlike to the genius of their age, betraying their perception that the absolutely trustworthy was seated at their heart." },
    { id: 205, length: "long", source: "Original", text: "The old lighthouse keeper climbed the spiral stairs every evening at the same hour. He did not count the steps anymore; his feet knew them. He trimmed the wick, polished the glass, and watched the beam sweep across the dark water. Ships he would never meet passed safely in the night, and that, he said, was the whole point of the job." },
    { id: 206, length: "long", source: "Original", text: "Learning to type well is mostly about unlearning bad habits. Stop looking at your hands, stop hunting for keys, and trust the home row. At first you will feel slower than before, and that is fine. Within a few weeks your fingers will find their places without being told, and the speed you lost will return, followed by speed you never had." },
    { id: 207, length: "long", source: "Original", text: "Every city has a sound of its own. In the early morning it is the rattle of shutters and the hiss of the first buses; at noon, a thousand conversations blending into one; at night, a low hum of engines and distant music. If you stand still long enough and simply listen, the city will tell you exactly who it is." },
    { id: 208, length: "long", source: "Mark Twain", text: "The Mississippi is well worth reading about. It is not a commonplace river, but on the contrary is in all ways remarkable. Considering the Missouri its main branch, it is the longest river in the world, four thousand three hundred miles. It seems safe to say that it is also the crookedest river in the world." },
    { id: 209, length: "long", source: "Original", text: "Good software is rarely written in a single brilliant burst. It grows through small, careful changes: a test added here, a confusing name fixed there, a function split in two when it starts doing too much. The best engineers are not the ones who never make mistakes, but the ones who build systems that make mistakes easy to notice and cheap to fix." },
    { id: 210, length: "long", source: "Original", text: "The train left the station just after dawn, carrying a handful of sleepy passengers through fields still silver with frost. Someone unfolded a newspaper, someone else pressed a forehead against the cold window, and a child counted the telegraph poles out loud until the numbers grew too large to say. By the time the sun was fully up, nobody could remember exactly when the journey had started to feel like home." }
  ]
};
