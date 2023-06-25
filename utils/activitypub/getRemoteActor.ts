import { FederatedHost, User } from '../../db'
import { environment } from '../../environment'
import { logger } from '../logger'
import { getPetitionSigned } from './getPetitionSigned'
import { Queue } from 'bullmq'

const updateUsersQueue = new Queue('UpdateUsers', {
  connection: environment.bullmqConnection,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: 1000
  }
})

async function getRemoteActor(actorUrl: string, user: any, level = 0, forceUpdate = false): Promise<any> {
  if (level === 100) {
    //Actor is not valid.
    return await User.findOne({
      where: {
        url: environment.deletedUser
      }
    })
  }
  const url = new URL(actorUrl)
  const hostQuery = await FederatedHost.findOne({
    where: {
      displayName: url.host
    }
  })
  const hostBanned = hostQuery?.blocked

  if (hostBanned) {
    return await User.findOne({
      where: {
        url: environment.deletedUser
      }
    })
  }
  let remoteUser = await User.findOne({
    where: {
      remoteId: actorUrl
    }
  })
  // we check if the user has changed avatar and stuff
  const validUntil = new Date(new Date().getTime() - 24 * 60 * 60 * 1000)
  if ((remoteUser && new Date(remoteUser.updatedAt).getTime() < validUntil.getTime()) || forceUpdate) {
    updateUsersQueue.add('updateUser', { userToUpdate: actorUrl, petitionBy: user }, { jobId: actorUrl })
  }

  if (!remoteUser) {
    try {
      const userPetition = await getPetitionSigned(user, actorUrl)
      const userToCreate = {
        url: `@${userPetition.preferredUsername}@${url.host}`,
        email: null,
        description: userPetition.summary,
        avatar: userPetition.icon?.url ? userPetition.icon.url : `${environment.mediaUrl}/uploads/default.webp`,
        password: 'NOT_A_WAFRN_USER_NOT_REAL_PASSWORD',
        publicKey: userPetition.publicKey?.publicKeyPem,
        remoteInbox: userPetition.inbox,
        remoteId: actorUrl,
        activated: true
      }
      remoteUser = await User.create(userToCreate)

      let federatedHost = await FederatedHost.findOne({
        where: {
          displayName: url.host.toLocaleLowerCase()
        }
      })
      if (!federatedHost) {
        const federatedHostToCreate = {
          displayName: url.host,
          publicInbox: userPetition.endpoints?.sharedInbox
        }
        federatedHost = await FederatedHost.create(federatedHostToCreate)
      }

      await federatedHost.addUser(remoteUser)
    } catch (error) {
      logger.trace({ message: 'error fetching user', error: error })
    }
  }

  return remoteUser
}

export { getRemoteActor }
