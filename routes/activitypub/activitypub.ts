import { Application } from 'express'
import { User, Follows, Post, Media, UserLikesPostRelations } from '../../db'
import checkFediverseSignature from '../../utils/activitypub/checkFediverseSignature'
import { sequelize } from '../../db'
import { Op } from 'sequelize'

import { environment } from '../../environment'
import { logger } from '../../utils/logger'

import { getRemoteActor } from '../../utils/activitypub/getRemoteActor'
import { removeUser } from '../../utils/activitypub/removeUser'
import { signAndAccept } from '../../utils/activitypub/signAndAccept'
import { getPostThreadRecursive } from '../../utils/activitypub/getPostThreadRecursive'
import { return404 } from '../../utils/return404'
import { postToJSONLD } from '../../utils/activitypub/postToJSONLD'

// global activitypub variables
const currentlyWritingPosts: Array<string> = []

// all the stuff related to activitypub goes here

function activityPubRoutes(app: Application) {
  // get post
  app.get(['/fediverse/post/:id', '/fediverse/activity/post/:id'], async (req: any, res) => {
    if (req.params?.id) {
      const post = await Post.findOne({
        where: {
          id: req.params.id
        }
      })
      if (post) {
        // TODO corregir esto seguramente
        res.send(await postToJSONLD(post, []))
      } else {
        res.sendStatus(404)
      }
    } else {
      res.sendStatus(404)
    }
    res.end()
  })
  // Get blog for fediverse
  app.get('/fediverse/blog/:url', async (req: any, res) => {
    if (req.params?.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', url)
      })
      if (user) {
        const userForFediverse = {
          '@context': ['https://www.w3.org/ns/activitystreams', 'https://w3id.org/security/v1'],
          id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}`,
          type: 'Person',
          following: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/following`,
          followers: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/followers`,
          featured: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/featured`,
          inbox: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/inbox`,
          outbox: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/outbox`,
          preferredUsername: user.url.toLowerCase(),
          name: user.url,
          summary: user.description,
          url: `${environment.frontendUrl}/blog/${user.url.toLowerCase()}`,
          manuallyApprovesFollowers: false,
          discoverable: true,
          published: user.createdAt,
          endpoints: {
            sharedInbox: `${environment.frontendUrl}/fediverse/sharedInbox`
          },
          icon: {
            type: 'Image',
            mediaType: 'image/webp',
            url: environment.mediaUrl + user.avatar
          },
          image: {
            type: 'Image',
            mediaType: 'image/webp',
            url: environment.mediaUrl + user.avatar
          },
          publicKey: {
            id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}#main-key`,
            owner: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}`,
            publicKeyPem: user.publicKey
          }
        }

        res
          .set({
            'content-type': 'application/activity+json'
          })
          .send(userForFediverse)
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
    res.end()
  })

  app.get('/fediverse/blog/:url/following', async (req: any, res) => {
    if (req.params?.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', url.toLowerCase())
      })
      if (user) {
        const followed = await user.getFollowed()
        let response: any = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/following`,
          type: 'OrderedCollection',
          totalItems: followed.length,
          first: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/following?page=1`
        }
        if (req.query?.page) {
          response = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/following`,
            type: 'OrderedCollection',
            totalItems: followed.length,
            partOf: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/following`,
            orderedItems: followed.map((elem: any) =>
              elem.remoteId ? elem.remoteId : `${environment.frontendUrl}/fediverse/blog/${elem.url}`
            )
          }
        }
        res.send(response)
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
    res.end()
  })

  app.get('/fediverse/blog/:url/followers', async (req: any, res) => {
    if (req.params?.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', url.toLowerCase())
      })
      if (user) {
        const followers = await user.getFollower()
        let response: any = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/followers`,
          type: 'OrderedCollection',
          totalItems: followers.length,
          first: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/followers?page=1`
        }
        if (req.query?.page) {
          response = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/followers`,
            type: 'OrderedCollection',
            totalItems: followers.length,
            partOf: `${environment.frontendUrl}/fediverse/blog/${user.url.toLowerCase()}/followers`,
            orderedItems: followers.map((elem: any) =>
              elem.remoteId ? elem.remoteId : `${environment.frontendUrl}/fediverse/blog/${elem.url}`
            )
          }
        }
        res.send(response)
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
    res.end()
  })

  app.get('/fediverse/blog/:url/featured', async (req: any, res) => {
    if (req.params?.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', url.toLowerCase())
      })
      if (user) {
        res.send({
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: `${environment.frontendUrl}/fediverse/blog/${req.params.url}/featured`,
          type: 'OrderedCollection',
          totalItems: 0,
          orderedItems: []
        })
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
    res.end()
  })

  // HERE is where the meat and potatoes are. This endpoint is what we use to recive stuff
  app.post(['/fediverse/blog/:url/inbox', '/fediverse/sharedInbox'], checkFediverseSignature, async (req: any, res) => {
    const urlToSearch = req.params?.url ? req.params.url : environment.deletedUser
    const url = urlToSearch.toLowerCase()
    const user = await User.findOne({
      where: sequelize.where(sequelize.fn('LOWER', sequelize.col('url')), 'LIKE', url.toLowerCase())
    })
    if (user) {
      try {
        const remoteUser = await getRemoteActor(req.body.actor, user)
        switch (req.body.type) {
          case 'Accept': {
            res.sendStatus(200)
            break
          }
          case 'Announce': {
            res.sendStatus(200)
            const retooted_content = await getPostThreadRecursive(user, req.body.object)
            const postToCreate = {
              content: '',
              content_warning: '',
              createdAt: new Date(),
              updatedAt: new Date(),
              userId: remoteUser.id,
              remotePostId: req.body.id
            }
            const newToot = await Post.create(postToCreate)
            await newToot.setParent(retooted_content)
            await newToot.save()
            await signAndAccept(req, remoteUser, user)

            break
          }
          case 'Create': {
            res.sendStatus(200)
            // Create new post
            const postRecived = req.body.object
            if (currentlyWritingPosts.indexOf(postRecived.id) === -1) {
              if (postRecived.type === 'Note') {
                currentlyWritingPosts.push(postRecived.id)
                const tmpIndex = currentlyWritingPosts.indexOf(postRecived.id)
                await getPostThreadRecursive(user, postRecived.id, postRecived)
                await signAndAccept(req, remoteUser, user)
                if (tmpIndex !== -1) {
                  currentlyWritingPosts[tmpIndex] = '_POST_ALREADY_WRITTEN_'
                }
              } else {
                logger.info(`post type not implemented: ${postRecived.type}`)
              }
            } else {
              logger.info('DEADLOCK AVOIDED')
            }
            break
          }
          case 'Follow': {
            // Follow user
            res.sendStatus(200)
            let remoteFollow = await Follows.findOne({
              where: {
                followerId: remoteUser.id,
                followedId: user.id
              }
            })
            if (!remoteFollow) {
              await user.addFollower(remoteUser)
              await user.save()
              remoteFollow = await Follows.findOne({
                where: {
                  followerId: user.id,
                  followedId: remoteUser.id
                }
              })
            }

            remoteFollow.remoteFollowId = req.body.id
            remoteFollow.save()
            // we accept it
            const acceptResponse = await signAndAccept(req, remoteUser, user)
            break
          }
          case 'Update': {
            res.sendStatus(200)
            const body = req.body.object
            switch (body.type) {
              case 'Note': {
                const postToEdit = await Post.findOne({
                  where: {
                    remotePostId: body.id
                  },
                  include: [
                    {
                      model: Media,
                      attributes: ['id']
                    }
                  ]
                })
                let mediasString = '';
                const medias = [];
                if (body.attachment && body.attachment.length > 0) {
                  for await (const remoteFile of body.attachment) {
                    const wafrnMedia = await Media.create({
                      url: remoteFile.url,
                      NSFW: body?.sensitive,
                      adultContent: !!body?.sensitive,
                      userId: remoteUser.id,
                      description: remoteFile.name,
                      ipUpload: 'IMAGE_FROM_OTHER_FEDIVERSE_INSTANCE',
                      external: true
                    })
                    medias.push(wafrnMedia)
                    mediasString = `${mediasString}[wafrnmediaid="${wafrnMedia.id}"]`
                  }
                }
                postToEdit.content = `${body.content}<p>${mediasString}<p>Post edited at ${body.updated}</p>`
                postToEdit.updatedAt = body.updated
                await postToEdit.save()
                const acceptResponse = await signAndAccept(req, remoteUser, user)

                break
              }
              default: {
                logger.info(`update not implemented ${body.type}`)
                logger.info(body.object)
              }
            }

            break
          }
          case 'Undo': {
            // Unfollow? Destroy post? what else can be undone

            res.sendStatus(200)
            const body = req.body
            switch (body.object.type) {
              case 'Follow': {
                const remoteFollow = await Follows.findOne({
                  where: {
                    // I think i was doing something wrong here. Changed so when remote unfollow does not cause you to unfollow them instead lol
                    followedId: remoteUser.id,
                    followerId: user.id,
                    remoteFollowId: body.object.id
                  }
                })
                if (remoteFollow) {
                  await remoteFollow.destroy()
                }
                await signAndAccept(req, remoteUser, user)
                break
              }
              case 'Undo': {
                // just undo? Might be like might be something else.
                const likeToRemove = await UserLikesPostRelations.findOne({
                  where: {
                    remoteId: req.body.object.id
                  }
                })
                if (likeToRemove) {
                  await likeToRemove.destroy()
                }
                break
              }
              case 'Announce': {
                const postToDelete = await Post.findOne({
                  where: {
                    remotePostId: req.body.object.id
                  }
                })
                if (postToDelete) {
                  const orphans = await postToDelete.getChildren({
                    where: {
                      hierarchyLevel: postToDelete.hierarchyLevel + 1
                    }
                  })
                  for (const orphan of orphans) {
                    orphan.parentId = postToDelete.parentId
                    await orphan.save()
                  }
                  await postToDelete.destroy()
                }
                await signAndAccept(req, remoteUser, user)
                break
              }
              default: {
                logger.info(`UNDO NOT IMPLEMENTED: ${req.body.type}`)
                logger.info(req.body)
              }
            }
            break
          }
          case 'Like': {
            const fullUrlPostToBeLiked = req.body.object
            const partToRemove = `${environment.frontendUrl}/fediverse/post/`
            const localPost = await Post.findOne({
              where: {
                id: fullUrlPostToBeLiked.substring(partToRemove.length)
              }
            })
            if (localPost && req.body.object.startsWith(environment.frontendUrl)) {
              const like = await UserLikesPostRelations.create({
                userId: remoteUser.id,
                postId: localPost.id,
                remoteId: req.body.id
              })
              await signAndAccept(req, remoteUser, user)
            }
            break
          }
          case 'Delete': {
            res.sendStatus(200)
            const body = req.body.object
            try {
              if (typeof body === 'string') {
                // we assume its just the url of an user
                await removeUser(req.body.object)
                await signAndAccept(req, remoteUser, user)
                break
              } else {
                switch (body.type) {
                  case 'Tombstone': {
                    const postToDelete = await Post.findOne({
                      where: {
                        remotePostId: body.id
                      }
                    })
                    if (postToDelete) {
                      const children = await postToDelete.getChildren()
                      if (children && children.length > 0) {
                        postToDelete.content = 'Post has been deleted'
                        await postToDelete.save()
                      } else {
                        await postToDelete.destroy()
                      }
                    }
                    await signAndAccept(req, remoteUser, user)
                    break
                  }
                  default:
                    {
                      logger.info(`DELETE not implemented ${body.type}`)
                      logger.info(body)
                    }
                    break
                }
              }
            } catch (error) {
              logger.trace({
                message: 'error with delete petition',
                error: error,
                petition: req.body
              })
            }
            break
          }
          default: {
            logger.info(`NOT IMPLEMENTED: ${req.body.type}`)
            logger.info(req.body.object)
            res.sendStatus(200)
          }
        }
      } catch (error) {
        logger.trace({
          error: error,
          type: req.body.type
        })
      }
    } else {
      return404(res)
    }
    res.end()
  })

  app.get('/fediverse/blog/:url/outbox', async (req: any, res) => {
    if (req.params?.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: {
          url
        }
      })
      if (user) {
        res.sendStatus(200)
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
    res.end()
  })
}

export { activityPubRoutes }