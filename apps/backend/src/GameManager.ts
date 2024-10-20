import { WebSocket } from "ws";
import { Quiz } from "./Quiz";
import { socketManager, User } from "./SocketManager";
import { Player } from "./types/types";

export class GameManager {
  private static instance: GameManager;
  private games: Quiz[];
  private users: User[];

  constructor() {
    this.games = [];
    this.users = [];
  }

  public static getInstance(): GameManager {
    if (!GameManager.instance) {
      GameManager.instance = new GameManager();
    }
    return GameManager.instance;
  }

  getGames(): Quiz[] {
    return this.games;
  }

  getPlayers(quizId: string): Player[] {
    return this.games.find((x) => x.quizId === quizId)?.getPlayers() ?? [];
  }

  addUser(user: User) {
    if (this.users.find((x) => x.userId === user.userId)) {
      console.error("User already exists in the list?");
      return;
    }
    this.users.push(user);
    this.addHandler(user);
    console.log("ADDING USER", user.name);
  }

  removeUser(socket: WebSocket) {
    const user = this.users.find((user) => user.socket === socket);
    if (!user) {
      console.error("User not found?");
      return;
    }
    this.users = this.users.filter((user) => user.socket !== socket);
    socketManager.removeUser(user);
  }

  removeGame(gameId: string) {
    this.games = this.games.filter((g) => g.quizId !== gameId);
  }

  private addHandler(user: User) {
    const socket = user.socket;
    socket.send(
      JSON.stringify({
        type: "USER_CONNECTED",
        userId: user.userId,
        name: user.name,
        gameState: this.getGames().map((x) => {
          return {
            quizId: x.quizId,
            quizName: x.quizName,
            players: this.getPlayers(x.quizId).map((y) => {
              return {
                name: y.name,
                userId: y.userId,
                avatar: y.avatar,
              };
            }),
          };
        }),
      })
    );

    socket.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      console.log(message);
      // write game logic here
      switch (message.type) {
        // search for a pending game in the list of games, if not found, create a new one
        case "CREATE_GAME":
          const newQuiz = new Quiz(message.quizName);

          socketManager.addUser(user, newQuiz.quizId); // add user to the game_room
          newQuiz.addPlayer(user); // add user to the quiz
          newQuiz.addQuestions(message.questions); // add questions

          console.log("New quiz created:", newQuiz);
          this.games.push(newQuiz);

          // send a message to the game_room to notify the user that a new game has been created
          socketManager.broadcast(
            newQuiz.quizId,
            JSON.stringify({
              type: "GAME_ADDED",
              quizId: newQuiz.quizId,
              gameState: this.getGames().map((x) => {
                return {
                  quizId: x.quizId,
                  quizName: x.quizName,
                  status: x.getStatus(),
                  questions: x.getQuestions(),
                  players: x.getPlayers().map((y) => {
                    return {
                      name: y.name,
                      userId: y.userId,
                      avatar: y.avatar,
                    };
                  }),
                };
              }),
            })
          );

          break;

        case "JOIN_GAME":
          const quiz = this.games.find((x) => x.quizId === message.quizId);
          if (!quiz) {
            console.error("Quiz not found?");
            return socket.send(
              JSON.stringify({
                type: "QUIZ_NOT_FOUND",
                quizId: message.quizId,
                gameState: this.getGames().map((x) => {
                  return {
                    quizId: x.quizId,
                    quizName: x.quizName,
                    status: x.getStatus(),
                    players: this.getPlayers(x.quizId).map((y) => {
                      return {
                        name: y.name,
                        userId: y.userId,
                        avatar: y.avatar,
                      };
                    }),
                  };
                }),
              })
            );
          }

          // restrict user from joining its own quiz
          const isUserAlreadyJoined = quiz
            .getPlayers()
            .find((x) => x.userId === user.userId);

          if (isUserAlreadyJoined) {
            console.error("User already joined the quiz?");
            return socket.send(
              JSON.stringify({
                type: "ALREADY_JOINED",
                quizId: quiz.quizId,
                gameState: this.getGames().map((x) => {
                  return {
                    quizId: x.quizId,
                    quizName: x.quizName,
                    players: this.getPlayers(x.quizId).map((y) => {
                      return {
                        name: y.name,
                        userId: y.userId,
                        avatar: y.avatar,
                      };
                    }),
                  };
                }),
              })
            );
          }
          quiz.addPlayer(user);
          socketManager.addUser(user, quiz.quizId);
          socketManager.broadcast(
            quiz.quizId,
            JSON.stringify({
              type: "USER_JOINED",
              userId: user.userId,
              name: user.name,
              quizId: quiz.quizId,
              gameState: this.getGames().map((x) => {
                return {
                  quizId: x.quizId,
                  quizName: x.quizName,
                  status: x.getStatus(),
                  questions: x.getQuestions(),
                  players: this.getPlayers(x.quizId).map((y) => {
                    return {
                      name: y.name,
                      userId: y.userId,
                      avatar: y.avatar,
                    };
                  }),
                };
              }),
            })
          );

          break;

        case "START_GAME":
          if (this.games.find((x) => x.quizId === message.quizId)) {
            this.games.find((x) => x.quizId === message.quizId)?.startGame();

            socketManager.broadcast(
              message.quizId,
              JSON.stringify({
                type: "USER_JOINED",
                userId: user.userId,
                name: user.name,
                quizId: message.quizId,
                gameState: this.getGames().map((x) => {
                  return {
                    quizId: x.quizId,
                    quizName: x.quizName,
                    status: x.getStatus(),
                    players: this.getPlayers(x.quizId).map((y) => {
                      return {
                        name: y.name,
                        userId: y.userId,
                        avatar: y.avatar,
                      };
                    }),
                  };
                }),
              })
            );
          } else {
            console.error("Game doesn't exists.");
          }
          break;

        case "ANSWER_QUESTION":
          // calculate score on the basis of correct answer and timing
          const game = this.games.find((x) => x.quizId === message.quizId);
          if (game) {
            const question = game.getCurrentQuestion();
            const isCorrect = question !== null && question.correctAnswer === message.answer;
            const timeTaken = message.timeTaken; // provided by the backend

            // Calculate score (example: max 1000 points, decreasing with time)
            const maxScore = 1000;
            const timeLimit = 30; // Assuming 30 seconds per question
            const score = isCorrect ? Math.max(0, maxScore - (timeTaken / timeLimit) * maxScore) : 0;

            // Update player's score
            const player = this.getPlayers(message.quizId).find((p) => p.userId === user.userId);
            if (player) {
              player.score += Math.round(score);
            }

            // Broadcast the answer result to all players
            socketManager.broadcast(
              message.quizId,
              JSON.stringify({
                type: "ANSWER_RESULT",
                userId: user.userId,
                name: user.name,
                isCorrect,
                score: Math.round(score),
                totalScore: player ? player.score : 0,
             })
            );
          } 
          else {
          console.error("Game not found for quiz ID:", message.quizId);
          }
          break;

        case "NEXT_QUESTION":
          // update the current question and send the new question to the client
          const gameToUpdate = this.games.find((x) => x.quizId === message.quizId);
          if (gameToUpdate) {
            const nextQuestion = gameToUpdate.nextQuestion();
            if (nextQuestion !== undefined) {
              // If there's a next question, send it to all players
              socketManager.broadcast(
                message.quizId,
                JSON.stringify({
                  type: "NEW_QUESTION",
                  question: {
                    id: nextQuestion?.id,
                    text: nextQuestion?.text,
                    options: nextQuestion?.options,
                    timeLimit: nextQuestion?.timeLimit,
                  },
                })
              );
            } else {
              // If there are no more questions, end the game
                interface Player {
                  userId: string;
                  name: string;
                  score: number; // Add the 'score' property
                }

                // Rest of the code...

              gameToUpdate.endGame();
              const finalScores = this.getPlayers(message.quizId).map((p) => ({
              userId: p.userId,
              name: p.name,
              score: p.score,
              }));
              socketManager.broadcast(
              message.quizId,
              JSON.stringify({
                type: "GAME_OVER",
                scores: finalScores.sort((a, b) => b.score - a.score), // Sort by score descending
              })
              );
            }
        }

          break;
        default:
          console.error("Unknown message type:", message.type);
      }
    });
  }
}
