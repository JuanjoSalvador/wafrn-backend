import axios from 'axios'
import { Application } from 'express'
import { User, FederatedHost, Follows, Post, Media } from '../models'
import checkFediverseSignature from '../utils/checkFediverseSignature'
import { createHash, createSign, randomBytes } from 'crypto'
import sequelize from '../db'
import getRemoteFollowers from '../utils/getRemoteFollowers'
import { canonize } from 'jsonld';
var https = require('https');
var httpSignature = require('@peertube/http-signature');

const environment = require('../environment')

// global activitypub variables
const currentlyWritingPosts: Array<string> = []

// all the stuff related to activitypub goes here

function activityPubRoutes (app: Application) {

  // webfinger protocol
  app.get('/.well-known/host-meta', (req: any, res) => {
    res.send(
      '<?xml version="1.0" encoding="UTF-8"?><XRD xmlns="http://docs.oasis-open.org/ns/xri/xrd-1.0"><Link rel="lrdd" template="' + environment.frontendUrl + '/.well-known/webfinger?resource={uri}"/></XRD>'
    )
  })
  app.get('/.well-known/webfinger/', async (req: any, res) => {
    if (req.query && req.query.resource) {
      const urlQueryResource: string = req.query.resource
      if (urlQueryResource.startsWith('acct:') && urlQueryResource.endsWith(environment.instanceUrl)) {
        const userUrl = urlQueryResource.slice(5).slice(0, -(environment.instanceUrl.length + 1))
        const user = await User.findOne({
          where: sequelize.where(
            sequelize.fn('LOWER', sequelize.col('url')),
            'LIKE',
            userUrl.toLowerCase()
          )
        })
        if (!user) {
          return404(res)
          return
        }
        const response = {
          subject: urlQueryResource,
          aliases: [
            environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase(),
            environment.frontendUrl + '/blog/' + user.url.toLowerCase()
          ],
          links: [
            {
              rel: 'self',
              type: 'application/activity+json',
              href: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase()
            },
            {
              rel: 'http://ostatus.org/schema/1.0/subscribe',
              template: environment.frontendUrl + '/fediverse/authorize_interaction?uri={uri}'
            }
          ]
        }
        res.send(
          response
        )
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
  })
  // get post
  app.get('/fediverse/post/:id', async (req: any, res) => {
    if(req.params && req.params.id) {
      const post = await Post.findOne({
        where: {
          id: req.params.id
        }
      })
      if(post) {
        // TODO corregir esto seguramente
        res.send(await postToJSONLD(post, []))
      } else {
        res.sendStatus(404)
      }
    } else {
      res.sendStatus(404)
    }
    
  })
  // Get blog for fediverse
  app.get('/fediverse/blog/:url', async (req: any, res) => {
    if (req.params && req.params.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('url')),
          'LIKE',
          url
        )
      })
      if (user) {
        const userForFediverse = {
          '@context': [
            'https://www.w3.org/ns/activitystreams',
            'https://w3id.org/security/v1'
          ],
          id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase(),
          type: 'Person',
          following: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/following',
          followers: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/followers',
          featured: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/featured',
          inbox: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/inbox',
          outbox: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/outbox',
          preferredUsername: user.url.toLowerCase(),
          name: user.url,
          summary: user.description,
          url: environment.frontendUrl + '/blog/' + user.url.toLowerCase(),
          manuallyApprovesFollowers: false,
          discoverable: true,
          published: user.createdAt,
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
            id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '#main-key',
            owner: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase(),
            publicKeyPem: user.publicKey
          }
        }

        res.set({
          'content-type': 'application/activity+json'
        }).send(userForFediverse)
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
  })

  app.get('/fediverse/blog/:url/following', async (req: any, res) => {
    if (req.params && req.params.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('url')),
          'LIKE',
          url.toLowerCase()
        )
      })
      if (user) {
        const followed = await user.getFollowed()
        let response: any = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/following',
          type: 'OrderedCollection',
          totalItems: followed.length,
          first: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/following?page=1'
        }
        if (req.query && req.query.page) {
          response = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/following',
            type: 'OrderedCollection',
            totalItems: followed.length,
            partOf: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/following',
            orderedItems: followed.map(
              (elem: any) => elem.remoteId ? elem.remoteId : environment.frontendUrl + '/fediverse/blog/' + elem.url
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
  }
  )

  app.get('/fediverse/blog/:url/followers', async (req: any, res) => {
    if (req.params && req.params.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('url')),
          'LIKE',
          url.toLowerCase()
        )
      })
      if (user) {
        const followers = await user.getFollower()
        let response: any = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/followers',
          type: 'OrderedCollection',
          totalItems: followers.length,
          first: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/followers?page=1'
        }
        if (req.query && req.query.page) {
          response = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/followers',
            type: 'OrderedCollection',
            totalItems: followers.length,
            partOf: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase() + '/followers',
            orderedItems: followers.map(
              (elem: any) => elem.remoteId ? elem.remoteId : environment.frontendUrl + '/fediverse/blog/' + elem.url
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
  }
  )

  app.get('/fediverse/blog/:url/featured', async (req: any, res) => {
    return404(res)
  })

  app.post('/fediverse/blog/:url/inbox', checkFediverseSignature, async (req: any, res) => {
    if (req.params && req.params.url) {
      const url = req.params.url.toLowerCase()
      const user = await User.findOne({
        where: sequelize.where(
          sequelize.fn('LOWER', sequelize.col('url')),
          'LIKE',
          url.toLowerCase()
        )
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
              const retooted_content = await getPostThreadRecursive(user, req.body.object )
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


              break;
            }
            case 'Create': {
              res.sendStatus(200)
              // Create new post
              const postRecived = req.body.object
              if (currentlyWritingPosts.indexOf(postRecived.id) === -1 ){
                currentlyWritingPosts.push(postRecived.id)
                const tmpIndex = currentlyWritingPosts.indexOf(postRecived.id)
                await getPostThreadRecursive(user, postRecived.id, postRecived)
                await signAndAccept(req, remoteUser, user)
                if (tmpIndex != -1) {
                  currentlyWritingPosts[tmpIndex] = '_POST_ALREADY_WRITTEN_'
                }
              } else {
                console.log('DEADLOCK AVOIDED')
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
                    }
                  })
                  postToEdit.content = body.content + '<p>Post edited at '+ body.updated + '</p>'
                  postToEdit.updatedAt = body.updated
                  await postToEdit.save()
                  const acceptResponse = await signAndAccept(req, remoteUser, user)


                  break
                }
                default: {
                  console.log('update not implemented ' + body.type)
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
                      followerId: remoteUser.id,
                      followedId: user.id,
                      remoteFollowId: body.object.id
                    }
                  })
                  if(remoteFollow) {
                    await remoteFollow.destroy()
                  }
                  await signAndAccept(req, remoteUser, user)
                }
                default: {
                  console.log('UNDO NOT IMPLEMENTED: ' + req.body.type)


                }
              }
              break
            }
            case 'Delete': {
              res.sendStatus(200)
              const body = req.body.object
              switch (body.type) {
                case 'Tombstone': {
                  const postToDelete = await Post.findOne({
                    where: {
                      remotePostId: body.id
                    }
                  })
                  if(postToDelete) {
                    const children = await postToDelete.getChildren()
                    if(children && children.length > 0) {
                      postToDelete.content = 'Post has been deleted'
                    } else {
                      await postToDelete.destroy()
                    }
                  }
                  await signAndAccept(req, remoteUser, user)
                  break
                }
                case undefined: {
                  // we assume its just the url of an user
                  const userToRemove = await User.findOne({where: {remoteId: req.body.object}})
                  if(userToRemove) {
                    userToRemove.url = userToRemove.url + '_DEACTIVATED'
                    userToRemove.remoteId = 'DELETED_USER'
                    const postsToRemove = userToRemove.getPosts()
                    if (postsToRemove && postsToRemove.length > 0) {
                      for await (const postToDelete of postsToRemove) {
                        const children = await postToDelete.getChildren()
                        if(children && children.length > 0) {
                          postToDelete.content = 'Post has been deleted'
                          await postToDelete.save()
                        } else {
                          await postToDelete.destroy()
                        }
                      }
                    }
                  }
                  await signAndAccept(req, remoteUser, user)
                  if(userToRemove) {
                    userToRemove.remoteInbox = 'DELETED_USER'
                    await userToRemove.save()
                  }
                  break;
                }
                default: {
                  console.log('DELETE not implemented ' + body.type)
                  console.log(req.body)
                }
              break
              }
              break
            }
            default: {
              console.log('NOT IMPLEMENTED: ' + req.body.type)
              res.sendStatus(200)
            }
          }
        } catch (error) {
          console.log('error happened: more detail');
          console.log(error)
        }
      } else {
        return404(res)
      }
    } else {
      return404(res)
    }
  })

  app.post('/fediverse/inbox', async (req: any, res) => {

  })

  app.get('/fediverse/blog/:url/outbox', async (req: any, res) => {
    if (req.params && req.params.url) {
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
  })
}

function return404 (res: any) {
  res.sendStatus(404)
}

async function getRemoteActor (actorUrl: string, user: any): Promise<any> {
  const url = new URL(actorUrl)

  // TODO properly sign petition
  let remoteUser = await User.findOne({
    where: {
      remoteId: actorUrl
    }
  })

  

  if (!remoteUser) {
    if (currentlyWritingPosts.indexOf(actorUrl) !== -1) {
      await new Promise(resolve => setTimeout(resolve, 250))
      return await getRemoteActor(actorUrl, user)
    } else {
      currentlyWritingPosts.push(actorUrl)
      const currentlyWritingObject = currentlyWritingPosts.indexOf(actorUrl) 
      const userPetition = await  signedGetPetition(user, actorUrl)
      const userToCreate = {
        url: '@' + userPetition.preferredUsername + '@' + url.host,
        email: null,
        description: userPetition.summary,
        avatar: userPetition.icon?.url ? userPetition.icon.url : '/uploads/default.webp',
        password: 'NOT_A_WAFRN_USER_NOT_REAL_PASSWORD',
        publicKey: userPetition.publicKey?.publicKeyPem,
        remoteInbox: userPetition.inbox,
        remoteId: actorUrl
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
      currentlyWritingPosts[currentlyWritingObject] = '_OBJECT_FINALLY_WRITTEN_'
    }
  }

  return remoteUser
}

async function postPetitionSigned (message: object, user: any, target: string): Promise<any> {
  console.log('http post signed to ' + target + ' started by ' + user.url )
  const url = new URL(target)
  const digest = createHash('sha256').update(JSON.stringify(message)).digest('base64')
  const signer = createSign('sha256')
  const sendDate = new Date()
  const stringToSign = `(request-target): post ${url.pathname}\nhost: ${url.host}\ndate: ${sendDate.toUTCString()}\ndigest: SHA-256=${digest}`
  signer.update(stringToSign)
  signer.end()
  const signature = signer.sign(user.privateKey).toString('base64')
  const header = `keyId="${environment.frontendUrl}/fediverse/blog/${user.url.toLocaleLowerCase()}#main-key",headers="(request-target) host date digest",signature="${signature}"`
  const headers =  {
    'Content-Type': 'application/activity+json',
    Accept: 'application/activity+json',
    Host: url.host,
    Date: sendDate.toUTCString(),
    Digest: `SHA-256=${digest}`,
    signature: header
  }
  let res;
  try {
    res =  await axios.post(target, message, {headers: headers})
    console.log('http post signed to ' + target + ' completed by ' + user.url )
  } catch (error) {
    console.log('Error during petition')
    //console.log(error)
  }
  return res

}

function signedGetPetition (user: any, target: string): Promise<any> {
  const res =  new Promise((resolve: any, reject: any) => {
    const url = new URL(target)
    const privKey = user.privateKey
    const options = {
      host: url.host,
      port: 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        //'Content-Type': 'application/activity+json',
        Accept: 'application/activity+json',
      }
    };
    const httpPetition = https.request(options, (response:any)=> {
      if(response.statusCode == 200){
        let data = ''
        response.on('data', (chunk: any) => data = data + chunk)
        response.on('end', () => {
          console.log('http get request to ' + url.href + ' has finished successfully, initiated by user ' + user.url)
          resolve(JSON.parse(data))
        })
      } else {
        reject({'code_get': response.statusCode, 'url': url.href, 'initiatedBy': user.url})
      }
    })
    httpSignature.signRequest(httpPetition, {
      key: privKey,
      keyId: `${environment.frontendUrl}/fediverse/blog/${user.url.toLocaleLowerCase()}#main-key`,
      algorithm: 'rsa-sha256',
      authorizationHeaderName: 'signature',
      headers: ['(request-target)', 'host', 'date', 'accept' ]
    });
    console.log('http get request to ' + url.href + ' initiated by user ' + user.url)
    httpPetition.end();
  })
  return res
}

async function signAndAccept (req: any, remoteUser: any, user: any) {
  const acceptMessage = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: req.body.id,
    type: 'Accept',
    actor: environment.frontendUrl + '/fediverse/blog/' + user.url.toLowerCase(),
    object: req.body
  }
  return await postPetitionSigned(acceptMessage, user, remoteUser.remoteInbox)
}

async function getPostThreadRecursive (user: any, remotePostId: string, remotePostObject?: any) {
  if(remotePostId.startsWith(environment.frontendUrl + '/fediverse/post/')) {
    // we are looking at a local post
    const partToRemove = environment.frontendUrl + '/fediverse/post/'
    const postId = remotePostId.substring(partToRemove.length)
    return await Post.findOne({where: {
      id: postId
    }})
  }
  const postInDatabase = await Post.findOne({
    where: {
      remotePostId :remotePostId 
    }
  })
  if (postInDatabase) {
    return postInDatabase
  } else {
    // TODO properly sign petition
    const postPetition = remotePostObject ? remotePostObject : await signedGetPetition(user, remotePostId)

    const remoteUser = await getRemoteActor(postPetition.attributedTo, user)
    let mediasString = ''
    const medias = []
    let privacy = 10
    
    if(postPetition.attachment && postPetition.attachment.length > 0) {
      for await (const remoteFile of postPetition.attachment) {
        const wafrnMedia = await Media.create({
          url: remoteFile.url,
          NSFW: remotePostObject?.sensitive,
          userId: remoteUser.id,
          description: remoteFile.name,
          ipUpload: 'IMAGE_FROM_OTHER_FEDIVERSE_INSTANCE',
          adultContent: remotePostObject?.sensitive,
          external: true
        })
        medias.push(wafrnMedia)
        mediasString = mediasString + '[wafrnmediaid="' + wafrnMedia.id + '"]'
      }
    }
    const postToCreate = {
      content: postPetition.content + mediasString,
      content_warning: postPetition.sensitive ? postPetition.summary : '',
      createdAt: new Date(postPetition.published),
      updatedAt: new Date(),
      userId: remoteUser.id,
      remotePostId
    }
    if (postPetition.inReplyTo) {
      const parent = await getPostThreadRecursive(user, postPetition.inReplyTo)
      const newPost = await Post.create(postToCreate)
      await newPost.setParent(parent)
      await newPost.save()
      newPost.addMedias(medias)
      return newPost
    } else {
      const post = await Post.create(postToCreate)
      post.addMedias(medias)
      return post
    }
  }
}

async function remoteFollow (localUser: any, remoteUser: any) {
  const petitionBody = { '@context': 'https://www.w3.org/ns/activitystreams',
  id: environment.frontendUrl + '/fediverse/follows/'+ localUser.id + '/' + remoteUser.id,
  type: 'Follow',
  actor: environment.frontendUrl + '/fediverse/blog/' + localUser.url,
  object: remoteUser.remoteId
 }
 const followPetition = await postPetitionSigned(petitionBody, localUser, remoteUser.remoteInbox)
  return followPetition
}


async function postToJSONLD(post: any, usersToSendThePost: string[]) {
  const localUser = await User.findOne({
    where: {
      id: post.userId
    }
  })
  const stringMyFollowers = environment.frontendUrl + '/fediverse/blog' + localUser.url + '/followers'
    const mentionedUsers: string[] = []
    const parentPost = post.parentId ? (await Post.findOne({where: {id: post.parentId}})) : null
    let parentPostString = null
    if(parentPost) {
      parentPostString = parentPost.remotePostId ? parentPost.remotePostId : environment.frontendUrl + '/fediverse/post/' + parentPost.id
    }
  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "ostatus": "http://ostatus.org#",
        "atomUri": "ostatus:atomUri",
        "inReplyToAtomUri": "ostatus:inReplyToAtomUri",
        "conversation": "ostatus:conversation",
        "sensitive": "as:sensitive",
        "toot": "http://joinmastodon.org/ns#",
        "votersCount": "toot:votersCount",
        "blurhash": "toot:blurhash",
        "focalPoint": {
          "@container": "@list",
          "@id": "toot:focalPoint"
        }
      }
    ],
    id: environment.frontendUrl + '/fediverse/post/' + post.id,
    type: 'Create',
    actor: environment.frontendUrl + '/fediverse/blog/' + localUser.url,
    published: post.createdAt,
    to: post.privacy == 2 ? mentionedUsers : [
       post.privacy === 0 ? 'https://www.w3.org/ns/activitystreams#Public' : stringMyFollowers 
    ],
    cc: post.privacy == 0 ? [stringMyFollowers, ...mentionedUsers] : [],
    object: {
      id: environment.frontendUrl + '/fediverse/post/' + post.id,
      type: "Note",
      summary: post.content_warning,
      inReplyTo: parentPostString,
      published: post.createdAt,
      url: environment.frontendUrl + '/post/' + post.id, 
      attributedTo: environment.frontendurl + '/fediverse/blog/' + localUser.url,
      to: post.privacy == 2 ? mentionedUsers : [
        post.privacy === 0 ? 'https://www.w3.org/ns/activitystreams#Public' : stringMyFollowers 
     ],
     cc: post.privacy == 0 ? [stringMyFollowers, ...mentionedUsers] : [],
      sensitive: !!post.content_warning,
      atomUri: environment.frontendUrl + '/fediverse/post/' + post.id,
      inReplyToAtomUri: parentPostString,
      "conversation": '',
      content: post.content,
      "attachment": [
        /*{
          "type": "Document",
          "mediaType": "image/png",
          "url": "https://hamburguesa.minecraftanarquia.xyz/system/media_attachments/files/109/678/071/574/445/597/original/4f1993925fdadebe.png",
          "name": null,
          "blurhash": "U78NkQ~qayIUj[ofofWBRjofj[RjWBofj[of",
          "width": 214,
          "height": 310
        }*/
      ],
      "tag": [],
      "replies": {
        "id": environment.frontendUrl + '/fediverse/post/' + post.id + '/replies',
        "type": "Collection",
        "first": {
          "type": "CollectionPage",
          "next": environment.frontendUrl + '/fediverse/post/' + post.id + '/replies&page=true',
          "partOf": environment.frontendUrl + '/fediverse/post/' + post.id + '/replies',
          "items": []
        }
      }
    }
  }
}

async function sendRemotePost (localUser: any, post: any) {
  const usersToSendThePost= await getRemoteFollowers(localUser.id)
  if(usersToSendThePost && usersToSendThePost.length > 0) {
    
    const objectToSend = await postToJSONLD(post, usersToSendThePost )
    for await (const remoteuser of usersToSendThePost) {
      try {
        const response = await postPetitionSigned(objectToSend, localUser, remoteuser)

      } catch (error) {
        console.log('Could not send post to ' + remoteuser)
      }
    }
  }
  
}



export { activityPubRoutes, remoteFollow, getRemoteActor, signedGetPetition, sendRemotePost }
