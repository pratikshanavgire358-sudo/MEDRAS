import firebase_admin
from firebase_admin import credentials

if not firebase_admin._apps:
    credential = credentials.ApplicationDefault()
    firebase_admin.initialize_app(credential)