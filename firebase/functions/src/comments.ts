import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { GeoPoint, DocumentReference, DocumentSnapshot, FieldValue } from "@google-cloud/firestore";
import * as Geohash from "ngeohash";
const db = admin.firestore();

/*
 {comment:string, currentStatus:string, location:object, photoUrl:string}
*/
exports.new_comment = functions.https.onCall(async (data, context) => {
  let comment: String;
  let currentStatus: String;
  let photoUrl: String;
  let geohash: String;
  let location: GeoPoint;
  if (typeof data.comment === "string" || data.comment instanceof String) {
    comment = data.comment;
  } else {
    comment = "";
  }
  if (
    typeof data.currentStatus === "string" ||
    data.currentStatus instanceof String
  ) {
    currentStatus = data.currentStatus;
  } else {
    currentStatus = "";
  }
  if (typeof data.photoUrl === "string" || data.photoUrl instanceof String) {
    photoUrl = data.photoUrl;
  } else {
    photoUrl = "";
  }
  if (
    typeof data.location[0] === "number" ||
    (data.location[0] instanceof Number &&
      typeof data.location[1] === "number") ||
    data.location[1] instanceof Number
  ) {
    if (
      data.location[0] >= -90 &&
      data.location[0] <= 90 &&
      data.location[1] >= -90 &&
      data.location[1] <= 90
    ) {
      location = new GeoPoint(data.location[0], data.location[1]);
      geohash = Geohash.encode(data.location[0], data.location[1]);
    } else {
      return {
        res: "No es una ubicacion Valida"
      };
    }
  } else {
    return {
      res: "No es una ubicacion Valida"
    };
  }
  const commentData = {
    timestamp: admin.firestore.Timestamp.now(),
    comment: comment,
    currentStatus: currentStatus,
    location: location,
    locationHash: geohash,
    photoUrl: photoUrl,
    votes: 0,
    voters: []
  };
  return await addToFIreBase(commentData, "Comments");
});
 

function addToFIreBase(data: any, collection: any) {
  return new Promise((resolve, reject) => {
    db.collection(collection)
      .add(data)
      .then(function(docRef) {
        resolve({
          res: "200" // add correct
        });
      })
      .catch(function(error) {
        console.log("Error de base de datos", error);
        reject(Error("Error Al añadir a la base de datos"));
      });
  });
}

exports.updateComment = functions.firestore
  .document('Comments/{commentId}')
  .onUpdate((change, context) => {
    const snap : DocumentSnapshot = change.after
    if (snap.get('votes') <= -20) {
      db.doc(`Comments.${snap.id}`).delete().then(() => {
        console.log('Comment with votes <= -20 successfully deleted.')
      })
      .catch(err => {
        console.log('updateComment: error deleting comment', err)
      })
    }
  });


enum VoteState {
  Null = 0,
  UpVote = 1,
  DownVote = 2,
  UpVoteRectified = 3,
  DownVoteRectified = 4
}


/** 
  This function works as a very simple state machine: 
  Users who haven't voted on a comment can either UpVote or DownVote and move to this state.
  Users who have already voted can rectify his/her vote and move to the state UpVoteRectified or DownVoteRectified

  Only one rectification is allowed. */
exports.vote = functions.https.onCall((data, context) => {
  return new Promise((resolve, reject) => {

    let sign : number
    let newVote : number
    let rectifiedVote : number
    let otherType : number
    let commentId: string
    let userId: string
    let voteType : string

    if (typeof data.commentId !== 'string' || typeof data.userId !== 'string' || typeof data.voteType !== 'string')  {
      reject({ res : "400", message : "One of the arguments is not a string" }) // Bad Request
      return
    }

    commentId = data.commentId
    userId = data.userId
    voteType = data.voteType
    
    switch (voteType) {
    case 'upvote':
      sign = 1
      newVote = VoteState.UpVote
      rectifiedVote = VoteState.UpVoteRectified
      otherType = VoteState.DownVote
    case 'downvote': 
      sign = -1
      newVote = VoteState.DownVote
      rectifiedVote = VoteState.DownVoteRectified
      otherType = VoteState.UpVote
    default:
      reject({ res : "400", message : "Not a valid voteType" })
      return 
    }

    const docRef : DocumentReference = db.doc(`Comments.${commentId}`)
    docRef.get().then(doc => {
      if (!doc.exists) {
        reject({ res: "404", message : "Comment doesn't exists" })
        return
      }
      let state : number = VoteState.Null
      if (userId in doc.get('voters')) {
        state = doc.get(`voters.${userId}`)
      }
      if (state === VoteState.Null || state === otherType) {
        const newState : number  = state === VoteState.Null ? newVote : rectifiedVote
        const increment : number = sign * (state === VoteState.Null ? 1 : 2 )
        docRef.set({ 
          voters : { userId : newState },
          votes : FieldValue.increment(increment)
        }, { 
          merge : true 
        })
        .then(res => { 
          console.log("upVote: success");
          resolve({ res : "200", message : "vote successful" }) 
        })
        .catch(err => { 
          console.log("upVote: Error writing to database", err)
          reject({res : "500", message : "vote : Error writing to database"})
        })
      } else {
        reject({ res : "403", message : "user has already voted and rectified his vote or is trying repeat the vote" })
      }
    })
  })
})
