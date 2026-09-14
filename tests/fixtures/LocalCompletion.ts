export const completionUser = "123e4567-e89b-42d3-a456-426614174000";
export function completionInfo() {
  return {
    gameID: "abCD1234",
    lobbyCreatedAt: 1000,
    start: 1000,
    end: 61000,
    duration: 60,
    num_turns: 600,
    lobbyFillTime: 0,
    winner: ["player", "abCD1234"],
    players: [
      {
        clientID: "abCD1234",
        username: "FriendOne",
        clanTag: null,
        persistentID: completionUser,
      },
    ],
    config: {
      gameMap: "Viktor",
      difficulty: "Medium",
      donateGold: false,
      donateTroops: false,
      gameType: "Singleplayer",
      gameMode: "Free For All",
      gameMapSize: "Normal",
      nations: "default",
      bots: 400,
      infiniteGold: false,
      infiniteTroops: false,
      instantBuild: false,
      randomSpawn: false,
    },
  };
}
