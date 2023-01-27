const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require( 'stripe')(process.env.STRIPE_SECRET_KEY);

app.use(cors());
app.use(express.json());




const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.j5nrexn.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req,res,next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).send({message:'unauthorize access'})
    }
    const token = authHeader.split(' ')[1];

    jwt.verify(token,process.env.ACCESS_TOKEN, function(error,decoded){
        if(error){
            return res.status(403).send({message:'forbidden access'})
        }
        req.decoded = decoded;
        next();
    })
}

async function run(){
    try{
        const appointmentOptionsCollection = client.db('DoctorsPortal').collection('appointmentOptions');
        const bookingsCollection = client.db('DoctorsPortal').collection('bookings');
        const usersCollection = client.db('DoctorsPortal').collection('users');
        const doctorsCollection = client.db('DoctorsPortal').collection('doctors');
        const paymentsCollection = client.db('DoctorsPortal').collection('payments');

        const verifyAdmin = async(req,res,next)=>{
            const decodedEmail = req.decoded.email;
            const query = {email:decodedEmail};
            const user = await usersCollection.findOne(query);
            if(user?.role !== 'admin'){
                return res.status(403).send({message:'forbidden access'})
            }
            next();

        }

        app.get('/appointmentOptions' , async(req,res)=>{
            const query = {};
            const options = await appointmentOptionsCollection.find(query).toArray();
            // steps no:01
            const date = req.query.date;
            const bookingQuery = {appointmentDate:date};
            const alreadyBooked = await bookingsCollection.find(bookingQuery).toArray();
            // steps no:02
            options.forEach(option => {
                const bookingOption = alreadyBooked.filter(book => book.treatment === option.name);
                const bookedSlots = bookingOption.map(book => book.slot);
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot));
                option.slots = remainingSlots;
                
            })
            res.send(options);
            });

        app.get('/appointmentSpecialty',async(req,res)=>{
            const query = {};
            const result = await appointmentOptionsCollection.find(query).project({name:1}).toArray();
            res.send(result)
        })    


        app.post('/bookings', async(req,res)=>{
            const booking = req.body;

            const query = {
                appointmentDate:booking.appointmentDate,
                email:booking.email,
                treatment:booking.treatment
            };
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if(alreadyBooked.length){
                const message = (`You already have a booking on ${booking.appointmentDate}`);
                return res.send({acknowledged:false,message});
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        }) 
        
        
        app.get('/bookings',verifyJWT, async(req,res)=>{
            const email = req.query.email;
            const query = { email:email};
            const decodedEmail = req.decoded.email;
            if(email !== decodedEmail){
                return res.status(403).send({message:'forbidden access'})
            }
            const result = await bookingsCollection.find(query).toArray();
            res.send(result)
        });

        app.get('/bookings/:id',async(req,res)=>{
            const id = req.params.id;
            const query = { _id : ObjectId(id)};
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        })

        app.post('/payments', async(req,res)=>{
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);
            const id = payment.bookingId;
            const filter = { _id : ObjectId(id)};
            const updatedDoc = {
                $set:{
                    paid : true,
                    transactionId : payment.transactionId
                }
            };
            const updateResult = await bookingsCollection.updateOne(filter,updatedDoc);
            res.send(result);
        })



        app.get('/jwt',async(req,res)=>{
            const email = req.query.email;
            const query = {email:email};
            const user = await usersCollection.findOne(query);
            if(user){
                const token = jwt.sign({email},process.env.ACCESS_TOKEN,{expiresIn:'30d'});
                return res.send({accessToken:token});
            }
            res.status(403).send({accessToken:''});
        })
        
        app.post('/users', async(req,res)=>{
            const user = req.body;
            const result = await usersCollection.insertOne(user);
            res.send(result);
        });
        
        app.get('/users',async(req,res)=>{
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        });

        app.get('/users/admin/:email', async(req,res)=>{
            const email = req.params.email;
            const query = {email};
            const user = await usersCollection.findOne(query);
            res.send({isAdmin : user?.role==='admin'});
            
            
        })

        app.put('/users/admin/:id',verifyJWT,verifyAdmin, async(req,res)=>{
            const id = req.params.id;
            const filter = {_id: ObjectId(id)};
            const options = {upsert:true};
            const updatedDoc = {
                $set : {
                    role: 'admin'
                }
            };
            const result = await usersCollection.updateOne(filter,updatedDoc,options);
            res.send(result)
        });

        // app.get('/addPrice',async(req,res)=>{
        //     const query = {};
        //     const options = {upsert:true};
        //     const updatedDoc = {
        //         $set : {
        //             price: 50
        //         }
        //     };
        //     const result = await appointmentOptionsCollection.updateMany(query,updatedDoc,options);
        //     res.send(result);
        // })

        app.post("/create-payment-intent", async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;
          
            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
              currency: "usd",
              amount,
              "payment_method_types": [
                "card"
              ],
            });
          
            res.send({
              clientSecret: paymentIntent.client_secret,
            });
          });

        app.post('/doctors',verifyJWT,verifyAdmin, async(req,res)=>{
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor);
            res.send(result);
        });

        app.get('/doctors',verifyJWT,verifyAdmin,async(req,res)=>{
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        });

        app.delete('/doctors/:id',verifyJWT,verifyAdmin,async(req,res)=>{
            const id = req.params.id;
            const query = {_id:ObjectId(id)};
            const result = await doctorsCollection.deleteOne(query);
            res.send(result);
        })

    }
    finally{

    }
}
run().catch(console.dir);



app.get(('/') , (req,res)=>{
    res.send("Doctors portal server is running");
})

app.listen(port, ()=>{
    console.log(`Doctors portal server is running on port : ${port}`);
})