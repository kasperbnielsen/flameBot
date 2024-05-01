import { Agenda } from "agenda";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  WebhookClient,
} from "discord.js";
import { MongoClient } from "mongodb";
import { api_token, token, connection_string, webhook_client } from "./config";

// Create a new client instance
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// When the client is ready, run this code (only once).
// The distinction between `client: Client<boolean>` and `readyClient: Client<true>` is important for TypeScript developers.
// It makes some properties non-nullable.
client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready! Logged in as ${readyClient.user.tag}`);
});

// Log in to Discord with your client's token
client.login(token);
function getLatestMatch() {
  return fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/by-puuid/VBOgMfMs8SKWFFggUbzKTRoZpO6hIXZU5_5QcjX5LVrQn2nMo5Eh31K5mD0-cJ4_zuI6KB1zX5QXaQ/ids?type=ranked&start=0&count=1&api_key=${api_token}`,
    { method: "GET" }
  ).then((res) => res.json());
}

function getMatchInfo(match: string): Promise<{
  metadata: { participants: string[] };
  info: {
    participants: Array<{
      win: boolean;
      championName: string;
      assists: number;
      lane: string;
      kills: number;
      deaths: number;
    }>;
  };
}> {
  return fetch(
    `https://europe.api.riotgames.com/lol/match/v5/matches/${match}?api_key=${api_token}`,
    { method: "GET" }
  ).then((res) => res.json());
}

function getCurrentRank() {
  return fetch(
    `https://euw1.api.riotgames.com/lol/league/v4/entries/by-summoner/BxtC88qhoAuCCoOoqhA6xrAS37TGEQZrN03OqfJKPeVDdTrSqEZJuSRbrw?api_key=${api_token}`,
    { method: "GET" }
  )
    .then(
      (res) =>
        res.json() as Promise<
          Array<{
            tier: string;
            rank: string;
            leaguePoints: number;
            wins: number;
            losses: number;
          }>
        >
    )
    .then((data) => {
      return data[1];
    });
}

async function isNewGame(matchId: string, mongoClient: MongoClient) {
  const database = mongoClient.db("william");
  const collection = database.collection<{ matchId: string }>("test");
  const is = await collection.updateOne({}, { $set: { matchId } }, {});
  if (is.modifiedCount > 0) await postMatch();
}

const webhookClient = new WebhookClient(webhook_client);

const embed = new EmbedBuilder().setTitle("test").setColor(0x00ffff);

async function postMatch() {
  return getLatestMatch()
    .then((res) => getMatchInfo(res))
    .then(async (data) => {
      const userData =
        data["info"]["participants"][
          data["metadata"]["participants"].findIndex(
            (val) =>
              val ===
              "VBOgMfMs8SKWFFggUbzKTRoZpO6hIXZU5_5QcjX5LVrQn2nMo5Eh31K5mD0-cJ4_zuI6KB1zX5QXaQ"
          )
        ];

      const currentRank = await getCurrentRank();

      webhookClient.send({
        content: `William ${
          userData["win"] ? "Won" : "lost"
        } with ${JSON.stringify(
          userData["championName"]
        )} in the ${JSON.stringify(userData["lane"])} with a KDA of ${(
          (userData["kills"] + userData["assists"]) /
          userData["deaths"]
        ).toFixed(2)}. \n His current rank is ${currentRank["tier"]} ${
          currentRank["rank"]
        } ${currentRank["leaguePoints"]}LP, with a winrate of ${(
          (currentRank["wins"] /
            (currentRank["losses"] + currentRank["wins"])) *
          100
        ).toFixed(2)}%`,
        username: "Hermelin Queue",
        avatarURL:
          "https://yt3.googleusercontent.com/2kPkLxXXsvyL1Vuq4E1g5Vmobd7Xla4oR0bm2PGD8hYJWRB13xpLAWqkKBXBmQuLV95_WDO0=s176-c-k-c0x00ffffff-no-rj",
        embeds: [embed],
      });
    });
}

(async () => {
  const client = await MongoClient.connect(connection_string, {});
  const agenda = new Agenda({ db: { address: connection_string } });
  // Define tasks
  agenda.define("checkMatch", async (job, done) => {
    const latestMatch = await getLatestMatch();
    isNewGame(latestMatch[0], client);
    done();
  });
  // Schedule tasks
  await agenda.start();
  agenda.every("20 seconds", "checkMatch");
})();

function getElo(
  matches: Pick<
    Awaited<ReturnType<typeof getCurrentRank>>,
    "rank" | "tier" | "leaguePoints"
  >
) {
  let rank = 0;

  switch (matches.rank) {
    case "I": {
      rank = 300;
      break;
    }
    case "II": {
      rank = 200;
      break;
    }
    case "III": {
      rank = 100;
      break;
    }
    case "IV": {
      rank = 0;
      break;
    }
    default:
      console.log("error switch statement");
  }

  let tier = 0;

  switch (matches.tier) {
    case "IRON": {
      tier = 0;
      break;
    }
    case "BRONZE": {
      tier = 400;
      break;
    }
    case "IRON": {
      tier = 800;
      break;
    }
    case "GOLD": {
      tier = 1200;
      break;
    }
    case "PLATINUM": {
      tier = 1600;
      break;
    }
    case "EMERALD": {
      tier = 2000;
      break;
    }
    case "DIAMOND": {
      tier = 2400;
      break;
    }
    default:
      console.log("error with 2nd switch statement");
  }

  return tier + rank + matches.leaguePoints;
}

(async () => {
  const client = await MongoClient.connect(connection_string, {});
  const agenda = new Agenda({ db: { address: connection_string } });
  // Define tasks
  agenda.define("test", async (job, done) => {
    const database = client.db("william");
    const collection = database.collection<{
      wins: number;
      losses: number;
      elo: number;
    }>("progress");

    const matches = await getCurrentRank();

    const newElo = getElo(matches);

    const oldMatches = await collection.findOneAndUpdate(
      {},
      {
        $set: {
          wins: matches["wins"],
          losses: matches["losses"],
          elo: newElo,
        },
      },
      { upsert: true, returnDocument: "before" }
    );

    webhookClient.send({
      content: `24hour Update: \n Games played: ${
        matches.wins +
        matches.losses -
        ((oldMatches?.wins || matches.wins) -
          (oldMatches?.losses || matches.losses))
      } \n Winrate: ${(
        ((matches.wins - (oldMatches?.wins || matches.wins)) /
          (matches.wins +
            matches.losses -
            ((oldMatches?.wins || matches.wins) +
              (oldMatches?.losses || matches.wins)))) *
        100
      ).toFixed(2)}% \n Elo gain: ${newElo - (oldMatches?.elo || 0)}LP`,
      username: "Hermelin Queue",
      avatarURL:
        "https://yt3.googleusercontent.com/2kPkLxXXsvyL1Vuq4E1g5Vmobd7Xla4oR0bm2PGD8hYJWRB13xpLAWqkKBXBmQuLV95_WDO0=s176-c-k-c0x00ffffff-no-rj",
      embeds: [embed],
    });

    done();
  });
  // Schedule tasks
  await agenda.start();
  agenda.every("24 hours", "test");
})();
