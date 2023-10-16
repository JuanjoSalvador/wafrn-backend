import { QuestionPoll, QuestionPollQuestion } from "../../db";
import { logger } from "../logger";
import { getPostThreadRecursive } from "./getPostThreadRecursive";

async function loadPoll(apObj: any, internalPostObject: any, user: any) {
try{
const multiChoice = apObj.anyOf != undefined;
  const remoteQuestions: any[] = apObj.anyOf ? apObj.anyOf : apObj.oneOf;
  const existingPoll = await QuestionPoll.findOne({where: {
    postId: internalPostObject.id
  }})
  // we check the poll and if it does not exists we create it
  const poll = existingPoll ? existingPoll : await QuestionPoll.create({
    postId: internalPostObject.id,
    endDate: new Date(apObj.closed),
    multiChoice: multiChoice
  });
  const questions = await poll.getQuestionPollQuestions();
  if(remoteQuestions.length === questions.length) {
    // all good. We might need to update names
  } else {
    // OH NO! the poll has a different number of things. We will assume that is new
    // just in case we will delete the vote tho
    for await (const question of questions) {
      await question.destroy();
    }
    for await (const [index, question] of remoteQuestions.entries()) {
      await QuestionPollQuestion.create({
          index: index,
          questionText: question.name,
          remoteReplies: question.replies.totalItems ? question.replies.totalItems : 0,
          questionPollId: poll.id
      })
    }
  }

} 
catch(error)
{
  logger.warn({error: error, ap: apObj, internalPostObject: internalPostObject})
}
  
}

export { loadPoll }